// lib/flow.ts
// Pure helpers for the connected plan (inputs -> forecast -> insulin -> move).

import type { Forecast, InputKey, OutputKey, PlanInput, PlanLink } from '@/services/api';

export const INPUT_ICON = {
  sugar: 'water-outline',
  food: 'restaurant-outline',
  stress: 'pulse-outline',
  activity: 'footsteps-outline',
  body: 'body-outline',
  insulin: 'eyedrop-outline',
} as const;

export const SHORT_LABEL: Record<InputKey, string> = {
  sugar: 'Sugar',
  food: 'Food',
  stress: 'Stress',
  activity: 'Activity',
  body: 'BMI',
  insulin: 'Insulin',
};

export const OUTPUTS: { key: OutputKey; title: string }[] = [
  { key: 'forecast', title: 'Next 60 minutes' },
  { key: 'insulin', title: 'Insulin' },
  { key: 'move', title: 'Activity advice' },
];

export const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** "+18" under an input, or null when it has no measured effect. */
export function effectChip(i: Pick<PlanInput, 'effect'>): string | null {
  return i.effect ? signed(Math.round(i.effect)) : null;
}

/** Line thickness: 2 for little or no effect, up to 8 for 40 mg/dL or more. */
export function lineWidth(effect: number | null | undefined): number {
  return 2 + Math.min(6, Math.abs(effect ?? 0) * 0.15);
}

export function linkFor(links: PlanLink[], from: InputKey, to: OutputKey): PlanLink | undefined {
  return links.find((l) => l.from === from && l.to === to);
}

/** Point at t (0-1) on the curve drawn from (x, 2) to (end, bottom). */
export function curveAt(t: number, x: number, end: number, bottom: number) {
  const c1 = (bottom + 6) * 0.55;
  const c2 = (bottom + 6) * 0.35;
  const u = 1 - t;
  const mix = (a: number, b: number, c: number, d: number) => u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d;
  return { x: mix(x, x, end, end), y: mix(2, c1, c2, bottom) };
}

export type Bar = { key: string; label: string; from: number; to: number; value: number; total?: boolean };

/**
 * A low is likely but the middle line hardly falls: people near a low usually
 * eat something, and the line has learned that. Showing "+6" there would
 * reassure, so the sum is replaced by a warning.
 */
export function assumesTreatment(f: Pick<Forecast, 'direction' | 'change_60'>): boolean {
  return f.direction === 'down' && (f.change_60 ?? 0) > -20;
}

/** Bars that add up from the sugar now to the sugar in an hour. */
export function waterfall(f: Pick<Forecast, 'current_bg' | 'effects' | 'change_60' | 'direction'>): Bar[] {
  const e = f.effects;
  if (!e || f.current_bg == null || assumesTreatment(f)) return [];
  const steps: [string, string, number][] = [
    ['trend', 'Sugar', e.trend],
    ['food', 'Food', e.food],
    ['insulin', 'Insulin', e.insulin],
    ['stress', 'Stress', e.stress],
    ['movement', 'Activity', e.movement],
  ];
  let at = f.current_bg;
  const bars: Bar[] = [{ key: 'now', label: 'Now', from: 0, to: at, value: at, total: true }];
  for (const [key, label, v] of steps) {
    if (!v) continue;
    bars.push({ key, label, from: at, to: at + v, value: v });
    at += v;
  }
  bars.push({ key: 'hour', label: '1 hour', from: 0, to: at, value: at, total: true });
  return bars;
}

export function clockAfter(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() + minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
