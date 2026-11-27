// lib/healthConnect.ts
//
// Automatic activity from two sources, used together:
//   1. our own all-day step counter (lib/stepRecorder.ts);
//   2. Android Health Connect (Google's replacement for the Google Fit API):
//      steps, distance, heart rate, calories, sleep, workouts, weight and
//      blood pressure from a watch, Google Fit, Samsung Health and others, and
//      blood sugar from meters and sensors that share it.
// Both may have counted the same walk, so for each 5 minutes the larger count
// is kept; they are never added. GlycoVision reads what it missed when the app
// opens, and about every 15 to 30 minutes in the background
// (lib/backgroundSync.ts).
//
// The native part exists only in the Android app build, so it is loaded on
// demand and every function is safe on web, iOS and in tests.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { onBloodSugarLogged } from '@/lib/notifications';
import { perMinute, recordedPoints, recorderOn } from '@/lib/stepRecorder';
import { syncHealth, type HealthDayTotal, type HealthSample, type HealthSession, type HealthVital } from '@/services/api';

const KEY_ON = 'gv.healthConnect.on';
const KEY_LAST = 'gv.healthConnect.lastSync';
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SYNC_MS = 3 * DAY_MS;
// After days without internet. The server takes up to 7 days.
const MAX_BACK_MS = 6.5 * DAY_MS;
const HISTORY_DAYS = 29;
// Watches upload late, so the recent past is always read again.
const OVERLAP_MS = 2 * 60 * 60 * 1000;
const SESSION_OVERLAP_MS = DAY_MS;
// Read a little earlier, so a point crossing the start is not cut off.
const EARLY_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 2 * 60 * 1000;
const CHUNK = 2000;

const TYPES = ['Steps', 'HeartRate', 'ActiveCaloriesBurned', 'Distance', 'SleepSession', 'ExerciseSession', 'Weight', 'BloodPressure', 'BloodGlucose'] as const;
const BACKGROUND = { accessType: 'read', recordType: 'BackgroundAccessPermission' } as const;
type Lib = typeof import('react-native-health-connect');

function lib(): Lib | null {
  if (Platform.OS !== 'android') return null;
  try {
    return require('react-native-health-connect') as Lib;
  } catch {
    return null;
  }
}

export type HealthStatus = 'unsupported' | 'needs_install' | 'off' | 'on';

async function grantedTypes(hc: Lib): Promise<string[]> {
  return (await hc.getGrantedPermissions()).map((g: any) => String(g.recordType));
}

export async function healthStatus(): Promise<HealthStatus> {
  const hc = lib();
  if (!hc) return 'unsupported';
  try {
    const s = await hc.getSdkStatus();
    if (s === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE) return 'unsupported';
    if (s !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'needs_install';
    await hc.initialize();
    const granted = await grantedTypes(hc);
    const any = granted.some((g) => (TYPES as readonly string[]).includes(g));
    return any && (await AsyncStorage.getItem(KEY_ON)) === '1' ? 'on' : 'off';
  } catch (e) {
    console.log('[health] status failed', e);
    return 'unsupported';
  }
}

/** What is allowed, for the "Allow more" button and the background switch. */
export async function healthAccess(): Promise<{ missing: number; background: boolean }> {
  const hc = lib();
  if (!hc || (await healthStatus()) !== 'on') return { missing: 0, background: false };
  try {
    const granted = await grantedTypes(hc);
    return { missing: TYPES.filter((t) => !granted.includes(t)).length, background: granted.includes(BACKGROUND.recordType) };
  } catch {
    return { missing: 0, background: false };
  }
}

/** Ask for permission. Returns what the user allowed. */
export async function connectHealth(): Promise<string[]> {
  const hc = lib();
  if (!hc) return [];
  await hc.initialize();
  const granted = await hc.requestPermission(TYPES.map((recordType) => ({ accessType: 'read', recordType })) as any);
  const allowed = granted.map((g: any) => String(g.recordType)).filter((t: string) => (TYPES as readonly string[]).includes(t));
  await AsyncStorage.setItem(KEY_ON, allowed.length ? '1' : '0');
  // The next sync reads everything again, including the month of history.
  await AsyncStorage.removeItem(KEY_LAST);
  return allowed;
}

/** Ask to read while the app is closed. False when refused or not supported. */
export async function allowBackground(): Promise<boolean> {
  const hc = lib();
  if (!hc) return false;
  try {
    await hc.initialize();
    await hc.requestPermission([BACKGROUND] as any);
    return (await grantedTypes(hc)).includes(BACKGROUND.recordType);
  } catch (e) {
    console.log('[health] background not available', e);
    return false;
  }
}

export async function disconnectHealth() {
  await AsyncStorage.multiRemove([KEY_ON, KEY_LAST]);
}

export async function openHealthSettings() {
  lib()?.openHealthConnectSettings();
}

/** Split [start, end] so each read stays small. */
export function dayChunks(start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (let t = start; t < end; t += DAY_MS) out.push([t, Math.min(t + DAY_MS, end)]);
  return out;
}

export function floor5(ms: number): number {
  const step = 5 * 60 * 1000;
  return Math.floor(ms / step) * step;
}

/**
 * Health Connect returns no step row while you sit still. If the watch was
 * recording heart rate then, "no steps" really means at rest, which the
 * stress gauge needs to know, so a 0 is added for those buckets.
 */
export function withRestingSteps(samples: HealthSample[]): HealthSample[] {
  const key = (t: string) => floor5(new Date(t).getTime());
  const walked = new Set(samples.filter((s) => s.kind === 'steps').map((s) => key(s.time)));
  const resting = samples
    .filter((s) => s.kind === 'heart_rate' && !walked.has(key(s.time)))
    .map((s) => ({ kind: 'steps' as const, time: s.time, value: 0 }));
  return [...samples.filter((s) => s.value > 0 || s.kind === 'steps'), ...resting];
}

/**
 * Move Minutes (30+ steps) and Heart Points (100+ steps = 1, 130+ = 2) per
 * 5-minute bucket, from steps counted minute by minute.
 */
export function minuteActivity(minutes: { time: string; steps: number }[]): HealthSample[] {
  const move = new Map<number, number>();
  const points = new Map<number, number>();
  for (const m of minutes) {
    const b = floor5(new Date(m.time).getTime());
    if (m.steps >= 30) move.set(b, Math.min(5, (move.get(b) ?? 0) + 1));
    const p = m.steps >= 130 ? 2 : m.steps >= 100 ? 1 : 0;
    if (p) points.set(b, Math.min(10, (points.get(b) ?? 0) + p));
  }
  const rows = (kind: 'move_min' | 'heart_pts', map: Map<number, number>) =>
    [...map].map(([t, value]) => ({ kind, time: new Date(t).toISOString(), value }));
  return [...rows('move_min', move), ...rows('heart_pts', points)];
}

/** Name used for the calories and points of a workout (services/fitness.py). */
export function workoutName(type: number, types: Record<string, number>, title?: string): string {
  const is = (...names: string[]) => names.some((n) => types[n] === type);
  if (is('WALKING')) return 'Walking';
  if (is('RUNNING', 'RUNNING_TREADMILL')) return 'Running';
  if (is('BIKING', 'BIKING_STATIONARY')) return 'Cycling';
  if (is('HIKING')) return 'Hiking';
  if (is('SWIMMING_POOL', 'SWIMMING_OPEN_WATER')) return 'Swimming';
  if (is('YOGA', 'PILATES')) return 'Yoga';
  if (is('STRETCHING', 'GUIDED_BREATHING')) return 'Stretching';
  if (is('STRENGTH_TRAINING', 'WEIGHTLIFTING')) return 'Strength';
  if (is('CRICKET')) return 'Cricket';
  if (is('SOCCER', 'FOOTBALL_AMERICAN', 'FOOTBALL_AUSTRALIAN')) return 'Football';
  if (is('BADMINTON')) return 'Badminton';
  if (is('STAIR_CLIMBING', 'STAIR_CLIMBING_MACHINE')) return 'Stairs';
  if (is('DANCING')) return 'Dancing';
  return title?.trim().slice(0, 60) || 'Workout';
}

/** Minutes per sleep stage (1 and 7 = awake, 3 = out of bed, 5 = deep, 6 = REM). */
export function sleepMinutes(stages: { startTime: string; endTime: string; stage: number }[] = []) {
  const sum = (...wanted: number[]) =>
    Math.round(
      stages.filter((s) => wanted.includes(s.stage)).reduce((t, s) => t + new Date(s.endTime).getTime() - new Date(s.startTime).getTime(), 0) / 60000,
    );
  return { deep_min: sum(5), rem_min: sum(6), awake_min: sum(1, 3, 7) };
}

export function goodVital(v: HealthVital): boolean {
  if (v.kind === 'weight') return v.value >= 15 && v.value <= 350;
  if (v.kind === 'blood_pressure') return v.value >= 50 && v.value <= 300 && !!v.value2 && v.value2 >= 30 && v.value2 <= 200 && v.value2 < v.value;
  return false;
}

export function goodGlucose(rows: Glucose[]): Glucose[] {
  return rows.filter((g) => Number.isFinite(g.value) && g.value >= 20 && g.value <= 600).slice(0, 2000);
}

/** The newest reading if it is at most 15 minutes old, else null. */
export function freshReading(rows: Glucose[], now: number): number | null {
  const newest = [...rows].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0];
  return newest && now - new Date(newest.time).getTime() <= 15 * 60 * 1000 ? Math.round(newest.value) : null;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const between = (a: number, b: number) => ({ operator: 'between' as const, startTime: new Date(a).toISOString(), endTime: new Date(b).toISOString() });

/** Steps counted between two moments (a workout), or null when unknown. */
export async function stepsBetween(start: number, end: number): Promise<number | null> {
  const counts: number[] = [];
  if (await recorderOn()) {
    try {
      counts.push(Math.round((await recordedPoints(start, end)).reduce((t, p) => t + p.steps, 0)));
    } catch {}
  }
  const hc = lib();
  if (hc && (await healthStatus()) === 'on') {
    try {
      const r: any = await hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter: between(start, end) });
      if (r?.COUNT_TOTAL != null) counts.push(r.COUNT_TOTAL);
    } catch {}
  }
  return counts.length ? Math.max(...counts) : null;
}

/** Our own counter's steps as 5-minute samples. */
export function recorderSamples(points: { start: number; end: number; steps: number }[], from: number): HealthSample[] {
  const minutes = [...perMinute(points)].filter(([t]) => t >= from);
  const buckets = new Map<number, number>();
  for (const [t, n] of minutes) buckets.set(floor5(t), (buckets.get(floor5(t)) ?? 0) + n);
  return [
    ...[...buckets].map(([t, n]) => ({ kind: 'steps' as const, time: new Date(t).toISOString(), value: Math.round(n) })),
    ...minuteActivity(minutes.map(([t, n]) => ({ time: new Date(t).toISOString(), steps: n }))),
  ];
}

/** One sample per kind and 5 minutes: the larger count, never the sum. */
export function largest(samples: HealthSample[]): HealthSample[] {
  const best = new Map<string, HealthSample>();
  for (const s of samples) {
    const key = `${s.kind}|${floor5(new Date(s.time).getTime())}`;
    const old = best.get(key);
    if (!old || s.value > old.value) best.set(key, s);
  }
  return [...best.values()];
}

/**
 * "Counted up to now, nothing yet": without it an hour of sitting looks like
 * an hour without data, and sitting could never be noticed.
 */
export function withNow(samples: HealthSample[], now: number): HealthSample[] {
  const t = floor5(now);
  if (samples.some((s) => s.kind === 'steps' && floor5(new Date(s.time).getTime()) === t)) return samples;
  return [...samples, { kind: 'steps', time: new Date(t).toISOString(), value: 0 }];
}

// One kind of data failing (no permission, odd record) must not stop the rest.
async function part(name: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (e) {
    console.log(`[health] ${name} failed`, e);
    if (name === 'Steps' || name === 'HeartRate') throw e;
  }
}

export type Glucose = { time: string; value: number };
type Extras = { sessions: HealthSession[]; vitals: HealthVital[]; days: HealthDayTotal[]; glucose: Glucose[] };

async function readHealthConnect(hc: Lib, start: number, now: number, last: number): Promise<{ samples: HealthSample[]; extras: Extras; countsSteps: boolean }> {
  const granted = await grantedTypes(hc);
  const has = (t: (typeof TYPES)[number]) => granted.includes(t);
  const samples: HealthSample[] = [];
  const five = { duration: 'MINUTES' as const, length: 5 };
  const one = { duration: 'MINUTES' as const, length: 1 };

  for (const [a, b] of dayChunks(start, now)) {
    const timeRangeFilter = between(a, b);
    // Aggregation lets Health Connect remove steps counted twice by a
    // phone and a watch.
    if (has('Steps')) {
      await part('Steps', async () => {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'Steps', timeRangeFilter, timeRangeSlicer: five });
        for (const r of rows) samples.push({ kind: 'steps', time: r.startTime, value: r.result?.COUNT_TOTAL ?? 0 });
      });
      await part('minutes', async () => {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'Steps', timeRangeFilter, timeRangeSlicer: one });
        samples.push(...minuteActivity(rows.map((r) => ({ time: r.startTime, steps: r.result?.COUNT_TOTAL ?? 0 }))));
      });
    }
    if (has('ActiveCaloriesBurned'))
      await part('calories', async () => {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'ActiveCaloriesBurned', timeRangeFilter, timeRangeSlicer: five });
        for (const r of rows) samples.push({ kind: 'active_kcal', time: r.startTime, value: r.result?.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0 });
      });
    if (has('Distance'))
      await part('distance', async () => {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'Distance', timeRangeFilter, timeRangeSlicer: five });
        for (const r of rows) samples.push({ kind: 'distance_m', time: r.startTime, value: r.result?.DISTANCE?.inMeters ?? 0 });
      });
    if (has('HeartRate'))
      await part('HeartRate', async () => {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'HeartRate', timeRangeFilter, timeRangeSlicer: five });
        for (const r of rows) {
          const bpm = r.result?.BPM_AVG;
          if (bpm) samples.push({ kind: 'heart_rate', time: r.startTime, value: bpm });
        }
      });
  }

  const sessions: HealthSession[] = [];
  const vitals: HealthVital[] = [];
  const since = between(last ? last - SESSION_OVERLAP_MS : now - HISTORY_DAYS * DAY_MS, now);
  if (has('SleepSession'))
    await part('sleep', async () => {
      const { records } = await hc.readRecords('SleepSession', { timeRangeFilter: since });
      for (const r of records as any[]) sessions.push({ kind: 'sleep', start: r.startTime, end: r.endTime, title: 'Sleep', ...sleepMinutes(r.stages) });
    });
  if (has('ExerciseSession'))
    await part('workouts', async () => {
      const { records } = await hc.readRecords('ExerciseSession', { timeRangeFilter: since });
      for (const r of records as any[])
        sessions.push({ kind: 'exercise', start: r.startTime, end: r.endTime, title: workoutName(r.exerciseType, hc.ExerciseType as any, r.title) });
    });
  if (has('Weight'))
    await part('weight', async () => {
      const { records } = await hc.readRecords('Weight', { timeRangeFilter: since });
      for (const r of records as any[]) vitals.push({ kind: 'weight', value: r.weight?.inKilograms, time: r.time });
    });
  if (has('BloodPressure'))
    await part('blood pressure', async () => {
      const { records } = await hc.readRecords('BloodPressure', { timeRangeFilter: since });
      for (const r of records as any[])
        vitals.push({ kind: 'blood_pressure', value: r.systolic?.inMillimetersOfMercury, value2: r.diastolic?.inMillimetersOfMercury, time: r.time });
    });

  // Blood sugar from a meter or sensor. Up to three days at a time.
  const glucose: Glucose[] = [];
  if (has('BloodGlucose'))
    await part('blood sugar', async () => {
      const from = Math.max(now - FIRST_SYNC_MS, last ? last - SESSION_OVERLAP_MS : 0);
      const { records } = await hc.readRecords('BloodGlucose', { timeRangeFilter: between(from, now), ascendingOrder: false, pageSize: 1000 });
      for (const r of records as any[]) glucose.push({ time: r.time, value: r.level?.inMilligramsPerDeciliter });
    });

  // First connection: a month of daily totals, so the charts start full.
  const days: HealthDayTotal[] = [];
  if (!last)
    await part('history', async () => {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const range = between(midnight.getTime() - HISTORY_DAYS * DAY_MS, midnight.getTime());
      const slice = { duration: 'DAYS' as const, length: 1 };
      const byDay = new Map<string, HealthDayTotal>();
      const put = (t: string, v: Partial<HealthDayTotal>) => {
        const day = localDay(new Date(t).getTime());
        byDay.set(day, { ...(byDay.get(day) ?? { day }), ...v });
      };
      if (has('Steps')) {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'Steps', timeRangeFilter: range, timeRangeSlicer: slice });
        for (const r of rows) if (r.result?.COUNT_TOTAL) put(r.startTime, { steps: r.result.COUNT_TOTAL });
      }
      if (has('Distance')) {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'Distance', timeRangeFilter: range, timeRangeSlicer: slice });
        for (const r of rows) if (r.result?.DISTANCE?.inMeters) put(r.startTime, { distance_m: r.result.DISTANCE.inMeters });
      }
      if (has('ActiveCaloriesBurned')) {
        const rows: any[] = await hc.aggregateGroupByDuration({ recordType: 'ActiveCaloriesBurned', timeRangeFilter: range, timeRangeSlicer: slice });
        for (const r of rows) if (r.result?.ACTIVE_CALORIES_TOTAL?.inKilocalories) put(r.startTime, { active_kcal: r.result.ACTIVE_CALORIES_TOTAL.inKilocalories });
      }
      days.push(...byDay.values());
    });

  return {
    samples: withRestingSteps(samples),
    extras: { sessions: sessions.slice(0, 300), vitals: vitals.filter(goodVital).slice(0, 300), days, glucose: goodGlucose(glucose) },
    countsSteps: has('Steps'),
  };
}

const KEY_ALERTED = 'gv.healthConnect.alerted';

/** A fresh reading from a meter or sensor alerts once, like one typed in. */
async function alertFresh(rows: Glucose[], now: number) {
  const value = freshReading(rows, now);
  if (value == null) return;
  const time = rows.reduce((a, b) => (new Date(b.time) > new Date(a.time) ? b : a)).time;
  if ((await AsyncStorage.getItem(KEY_ALERTED).catch(() => null)) === time) return;
  await AsyncStorage.setItem(KEY_ALERTED, time).catch(() => {});
  onBloodSugarLogged(value);
}

let running = false;

/** Automatic activity is on, from either source. */
export async function trackingOn(): Promise<boolean> {
  return (await recorderOn()) || (await healthStatus()) === 'on';
}

/** Read anything new and send it. Returns the number of samples sent. */
export async function syncNow(force = false): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const recorder = await recorderOn();
    const hc = (await healthStatus()) === 'on' ? lib() : null;
    if (!recorder && !hc) return 0;
    const now = Date.now();
    const last = Number(await AsyncStorage.getItem(KEY_LAST)) || 0;
    if (!force && now - last < MIN_GAP_MS) return 0;
    // Whole 5-minute buckets only: a partial first bucket would replace a
    // full one already saved on the server.
    const start = floor5(last ? Math.max(now - MAX_BACK_MS, last - OVERLAP_MS) : now - FIRST_SYNC_MS);

    let samples: HealthSample[] = [];
    let extras: Extras = { sessions: [], vitals: [], days: [], glucose: [] };
    let counting = false;
    let complete = true;
    if (recorder) {
      try {
        samples.push(...recorderSamples(await recordedPoints(start - EARLY_MS, now), start));
        counting = true;
      } catch (e) {
        console.log('[steps] read failed', e);
        complete = false;
      }
    }
    if (hc) {
      try {
        const r = await readHealthConnect(hc, start, now, last);
        samples.push(...r.samples);
        extras = r.extras;
        counting = counting || r.countsSteps;
      } catch (e) {
        // For example no background permission: the next time the app opens
        // reads this period again.
        console.log('[health] sync failed', e);
        complete = false;
      }
    }
    if (!complete && !counting) return 0;

    // Before anything is sent: a fresh low must alert without internet too.
    await alertFresh(extras.glucose, now);
    samples = largest(samples);
    if (counting) samples = withNow(samples, now);
    for (let i = 0; i < samples.length; i += CHUNK) await syncHealth({ samples: samples.slice(i, i + CHUNK) });
    let newSugar = 0;
    if (extras.sessions.length || extras.vitals.length || extras.days.length || extras.glucose.length) {
      newSugar = (await syncHealth({ samples: [], ...extras })).glucose ?? 0;
    }
    if (complete) await AsyncStorage.setItem(KEY_LAST, String(now));
    return samples.length + newSugar;
  } catch (e) {
    console.log('[health] sync failed', e);
    return 0;
  } finally {
    running = false;
  }
}
