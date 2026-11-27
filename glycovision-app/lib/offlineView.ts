// lib/offlineView.ts
//
// Puts entries that are still on the phone into the saved copies, so a reading
// logged without internet shows at once. Pure functions. Yesterday's copy is
// never shown as today.

import type { Entry } from '@/lib/offline';
import type { BgReading, MedicineDose, MedicineOverview, TimelineEvent } from '@/services/api';

export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const sameDay = (a: number, b: number) => localDay(a) === localDay(b);

const ofKind = (waiting: Entry[], kind: Entry['kind']) => waiting.filter((e) => e.kind === kind);
const today = (waiting: Entry[], now: number) => waiting.filter((e) => sameDay(e.at, now));

export function withReadings(readings: BgReading[], waiting: Entry[], hours: number, now: number): BgReading[] {
  const from = now - hours * 3600_000;
  const mine = ofKind(waiting, 'bg').map((e) => ({ id: e.id, value: e.body.value, logged_at: new Date(e.at).toISOString() }));
  return [...readings, ...mine]
    .filter((r) => new Date(r.logged_at).getTime() >= from)
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());
}

export interface Summary {
  full_name: string;
  diabetes_type: string;
  total_carbs_today: number;
  total_insulin_today: number;
  meals_logged_today: number;
  latest_bg: number | null;
  time_in_range_pct: number | null;
  bg_readings_today: number;
}

export function withSummary(copy: Summary, at: number, waiting: Entry[], now: number): Summary {
  const base = sameDay(at, now)
    ? copy
    : { ...copy, total_carbs_today: 0, total_insulin_today: 0, meals_logged_today: 0, latest_bg: null, time_in_range_pct: null, bg_readings_today: 0 };
  const mine = today(waiting, now);
  const sugars = ofKind(mine, 'bg');
  const meals = ofKind(mine, 'meal');
  const round1 = (x: number) => Math.round(x * 10) / 10;
  const count = base.bg_readings_today + sugars.length;
  const inRange = ((base.time_in_range_pct ?? 0) / 100) * base.bg_readings_today + sugars.filter((e) => e.body.value >= 70 && e.body.value <= 180).length;
  return {
    ...base,
    total_carbs_today: round1(base.total_carbs_today + meals.reduce((s, e) => s + (e.body.carbs ?? 0), 0)),
    total_insulin_today: round1(base.total_insulin_today + ofKind(mine, 'bolus').reduce((s, e) => s + (e.body.dose_units ?? 0), 0)),
    meals_logged_today: base.meals_logged_today + meals.length,
    latest_bg: sugars.length ? sugars[sugars.length - 1].body.value : base.latest_bg,
    time_in_range_pct: count ? Math.round((inRange / count) * 100) : null,
    bg_readings_today: count,
  };
}

const WAITING = 'Saved on this phone';

export function withTimeline(events: TimelineEvent[], at: number, waiting: Entry[], now: number): TimelineEvent[] {
  const mine: TimelineEvent[] = [];
  for (const e of today(waiting, now)) {
    const logged_at = new Date(e.at).toISOString();
    const id = `local:${e.id}`;
    if (e.kind === 'meal') mine.push({ id, type: 'meal', title: e.body.food_name || 'Meal', detail: `${Math.round(e.body.carbs ?? 0)} g carbs · ${WAITING}`, logged_at });
    else if (e.kind === 'bolus') mine.push({ id, type: 'insulin', title: `${e.body.dose_units} u insulin`, detail: WAITING, logged_at });
    else if (e.kind === 'bg') mine.push({ id, type: 'bg', title: `${Math.round(e.body.value)} mg/dL`, detail: WAITING, value: e.body.value, logged_at });
  }
  return [...mine, ...(sameDay(at, now) ? events : [])].sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
}

// Same limits as backend services/medicines.py.
const DUE_SOON_MIN = 30;
const LATE_MIN = 120;

export function doseState(time: string, nowMin: number, status: 'taken' | 'skipped' | null): MedicineDose['state'] {
  if (status) return status;
  const [h, m] = time.split(':').map(Number);
  const at = h * 60 + m;
  if (nowMin > at + LATE_MIN) return 'missed';
  return nowMin >= at - DUE_SOON_MIN ? 'due' : 'later';
}

export function withMedicines(copy: MedicineOverview, waiting: Entry[], now: number): MedicineOverview {
  const day = localDay(now);
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const status = new Map<string, 'taken' | 'skipped' | null>();
  if (copy.day === day) {
    for (const x of copy.today) if (x.state === 'taken' || x.state === 'skipped') status.set(`${x.medicine_id} ${x.time}`, x.state);
  }
  for (const e of ofKind(waiting, 'medicine')) {
    if (e.body.day === day) status.set(`${e.body.medicine_id} ${e.body.time}`, e.body.status ?? null);
  }
  const doses: MedicineDose[] = copy.medicines.flatMap((m) =>
    m.times.map((time) => ({ medicine_id: m.id, name: m.name, dose: m.dose, time, state: doseState(time, nowMin, status.get(`${m.id} ${time}`) ?? null) })),
  );
  doses.sort((a, b) => a.time.localeCompare(b.time) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { ...copy, day, today: doses };
}

const NAMES: Record<Entry['kind'], (b: Record<string, any>) => string> = {
  bg: (b) => `Blood sugar ${Math.round(b.value)} mg/dL`,
  meal: (b) => `${b.food_name || 'Meal'}, ${Math.round(b.carbs ?? 0)} g carbs`,
  bolus: (b) => `Insulin ${b.dose_units} units`,
  activity: (b) => `${b.activity}, ${b.minutes} min`,
  vital: (b) => ({ weight: 'Weight', blood_pressure: 'Blood pressure', hba1c: 'HbA1c', sleep: 'Sleep' })[b.kind as string] ?? 'Body number',
  medicine: (b) => (b.status === 'taken' ? `Medicine taken (${b.time})` : b.status === 'skipped' ? `Medicine skipped (${b.time})` : `Medicine mark undone (${b.time})`),
};
export const entryName = (e: Entry) => NAMES[e.kind](e.body);
