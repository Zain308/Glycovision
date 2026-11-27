// lib/fitness.ts
// Pure helpers for the Fitness tab and live workouts.

import type { FitnessDay } from '@/services/api';

export type MetricKey = 'steps' | 'heart_pts' | 'move_min' | 'distance_m' | 'active_kcal' | 'active_hours' | 'hr_resting';

export const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: 'steps', label: 'Steps', unit: 'steps' },
  { key: 'heart_pts', label: 'Heart Points', unit: 'points' },
  { key: 'move_min', label: 'Move Minutes', unit: 'min' },
  { key: 'distance_m', label: 'Distance', unit: 'km' },
  { key: 'active_kcal', label: 'Calories', unit: 'kcal' },
  { key: 'active_hours', label: 'Active hours', unit: 'h' },
  { key: 'hr_resting', label: 'Resting heart', unit: 'bpm' },
];

export const km = (m: number | null | undefined) => (m == null ? null : m / 1000);

export function minutesText(m: number | null | undefined): string {
  if (m == null) return '–';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`;
}

export function metricValue(day: FitnessDay, key: MetricKey): number | null {
  const v = day[key];
  return v == null ? null : key === 'distance_m' ? v / 1000 : v;
}

export function formatMetric(v: number | null, key: MetricKey): string {
  if (v == null) return '–';
  return key === 'distance_m' ? v.toFixed(1) : Math.round(v).toLocaleString();
}

/** Average over the days that have data. */
export function average(days: FitnessDay[], key: MetricKey): number | null {
  const values = days.map((d) => metricValue(d, key)).filter((v): v is number => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Chart top: a round number at or above every bar and the goal. */
export function niceTop(max: number): number {
  if (max <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * step >= max) return k * step;
  return 10 * step;
}

export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** METs, same list as services/fitness.py. */
export const WORKOUTS = [
  { name: 'Walking', met: 3.3, icon: 'walk-outline', steps: true },
  { name: 'Running', met: 8, icon: 'speedometer-outline', steps: true },
  { name: 'Cycling', met: 5, icon: 'bicycle-outline', steps: false },
  { name: 'Stretching', met: 2.3, icon: 'body-outline', steps: false },
  { name: 'Yoga', met: 2.5, icon: 'leaf-outline', steps: false },
  { name: 'Strength', met: 3.5, icon: 'barbell-outline', steps: false },
  { name: 'Cricket', met: 4.8, icon: 'baseball-outline', steps: true },
  { name: 'Football', met: 7, icon: 'football-outline', steps: true },
  { name: 'Badminton', met: 5.5, icon: 'tennisball-outline', steps: true },
  { name: 'Housework', met: 3, icon: 'home-outline', steps: true },
] as const;

export function workoutKcal(met: number, weightKg: number | null | undefined, seconds: number): number | null {
  return weightKg ? Math.round((met * weightKg * seconds) / 3600) : null;
}

/** Step length is about 0.414 of height; 0.70 m when height is unknown. */
export function distanceFromSteps(steps: number, heightCm: number | null | undefined): number {
  return Math.round(steps * (heightCm ? 0.00414 * heightCm : 0.7));
}

/** Steps a minute, and what it means (100+ brisk, 130+ vigorous). */
export function pace(steps: number, seconds: number): { perMinute: number; label: string } {
  const perMinute = seconds >= 30 ? Math.round((steps / seconds) * 60) : 0;
  return { perMinute, label: perMinute >= 130 ? 'Vigorous' : perMinute >= 100 ? 'Brisk' : perMinute >= 30 ? 'Easy' : 'Resting' };
}
