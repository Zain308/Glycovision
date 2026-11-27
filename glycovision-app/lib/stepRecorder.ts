// lib/stepRecorder.ts
//
// GlycoVision's own all-day step counter (modules/step-recorder), using the
// Recording API in Google Play services. The phone keeps counting while the
// app is closed and after a restart, without Google Fit or a Google account.
// The app reads the steps later; the phone keeps them for 10 days.
//
// Not in Expo Go, on web or on iOS: every function is safe there.

import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';

const KEY_ON = 'gv.stepRecorder.on';
const MINUTE = 60 * 1000;

interface Native {
  isAvailable(): boolean;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  read(startMs: number, endMs: number): Promise<number[]>;
}

export type StepPoint = { start: number; end: number; steps: number };

let native: Native | null | undefined;
function mod(): Native | null {
  if (Platform.OS !== 'android') return null;
  if (native === undefined) native = requireOptionalNativeModule<Native>('StepRecorder');
  return native;
}

export function recorderAvailable(): boolean {
  try {
    return !!mod()?.isAvailable();
  } catch {
    return false;
  }
}

export async function recorderOn(): Promise<boolean> {
  return recorderAvailable() && (await AsyncStorage.getItem(KEY_ON).catch(() => null)) === '1';
}

export type StartResult = 'on' | 'unavailable' | 'denied' | 'failed';

/** Ask for permission and start counting. */
export async function startRecorder(): Promise<StartResult> {
  if (!recorderAvailable()) return 'unavailable';
  try {
    if (Number(Platform.Version) >= 29) {
      const answer = await PermissionsAndroid.request('android.permission.ACTIVITY_RECOGNITION');
      if (answer !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
    }
    await mod()!.start();
    await AsyncStorage.setItem(KEY_ON, '1');
    return 'on';
  } catch (e) {
    console.log('[steps] could not start', e);
    return 'failed';
  }
}

export async function stopRecorder() {
  await AsyncStorage.setItem(KEY_ON, '0');
  await mod()?.stop().catch(() => {});
}

/** [start, end, steps, …] from the phone -> points, oldest first. */
export function toPoints(flat: number[]): StepPoint[] {
  const out: StepPoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    if (flat[i + 2] > 0 && flat[i + 1] >= flat[i]) out.push({ start: flat[i], end: flat[i + 1], steps: flat[i + 2] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Steps for each minute. A point can cover several minutes; its steps are
 * shared out evenly, so a long point never looks like a burst of running.
 */
export function perMinute(points: StepPoint[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of points) {
    const end = Math.max(p.end, p.start + 1);
    for (let m = Math.floor(p.start / MINUTE) * MINUTE; m < end; m += MINUTE) {
      const inside = Math.min(end, m + MINUTE) - Math.max(p.start, m);
      out.set(m, (out.get(m) ?? 0) + (p.steps * inside) / (end - p.start));
    }
  }
  return out;
}

/** What the recorder counted. Throws when it can't be read. */
export async function recordedPoints(start: number, end: number): Promise<StepPoint[]> {
  const m = mod();
  if (!m) return [];
  await m.start(); // renews it; does nothing when already counting
  return toPoints(await m.read(start, end));
}
