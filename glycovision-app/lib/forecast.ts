// lib/forecast.ts
// Small pure helpers for the 60-minute forecast screens.

import { RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';
import type { Forecast, ForecastPoint } from '@/services/api';

/** Chart limits: always show 70 and 180, plus the whole predicted range. */
export function chartRange(points: ForecastPoint[]): [number, number] {
  const lo = Math.min(RANGE_LOW, ...points.map((p) => p.low));
  const hi = Math.max(RANGE_HIGH, ...points.map((p) => p.high));
  return [Math.max(30, Math.floor((lo - 15) / 10) * 10), Math.ceil((hi + 20) / 10) * 10];
}

/** When the expected line first leaves the 70-180 range, if it does. */
export function crossing(points: ForecastPoint[]): { minute: number; limit: 70 | 180 } | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const limit of [RANGE_LOW, RANGE_HIGH] as const) {
      const out = limit === RANGE_LOW ? a.mid >= limit && b.mid < limit : a.mid <= limit && b.mid > limit;
      if (out) {
        const t = (limit - a.mid) / (b.mid - a.mid);
        return { minute: Math.round(a.minute + t * (b.minute - a.minute)), limit: limit as 70 | 180 };
      }
    }
  }
  return null;
}

/**
 * "Up 38", "Down 25" or "Steady". When a spike or low is likely but the
 * middle estimate hardly moves, it names the value the sugar could reach.
 */
export function changeLabel(f: Pick<Forecast, 'direction' | 'change_60' | 'range_60' | 'based_on'>): { text: string; unit: string } {
  const change = Math.round(f.change_60 ?? 0);
  if (f.direction === 'up') {
    return change >= 20
      ? { text: `Up ${change}`, unit: 'mg/dL, expected change' }
      : { text: `Up to ${f.range_60?.[1] ?? '?'}`, unit: 'mg/dL possible' };
  }
  if (f.direction === 'down') {
    return change <= -20
      ? { text: `Down ${-change}`, unit: 'mg/dL, expected change' }
      : { text: `Down to ${f.range_60?.[0] ?? '?'}`, unit: 'mg/dL possible' };
  }
  if (f.based_on?.startsWith('single')) return { text: 'Not clear yet', unit: 'one reading can’t show the direction' };
  return { text: 'Steady', unit: 'no sharp change expected' };
}

/** How far to trust it, in words, from how many readings it had. */
export function confidence(basedOn: string | undefined): { label: string; hint: string | null } {
  switch (basedOn) {
    case 'cgm':
    case 'cgm_watch':
      return { label: 'Based on sensor readings', hint: null };
    case 'fingerstick_3':
      return { label: 'Based on several readings', hint: null };
    case 'fingerstick_1':
      return { label: 'Based on two readings', hint: 'A third reading would make it more exact.' };
    default:
      return {
        label: 'Rough estimate: one reading only',
        hint: 'One reading can’t show which way your sugar is moving. Check again in 15 to 30 minutes for a real trend.',
      };
  }
}

/** Short line about leaving the target range. */
export function crossingText(points: ForecastPoint[] | undefined): string | null {
  const c = points ? crossing(points) : null;
  if (!c) return null;
  const when = c.minute <= 1 ? 'very soon' : `in about ${c.minute} minutes`;
  return c.limit === 180 ? `May pass 180 ${when}` : `May drop below 70 ${when}`;
}

// ------------------------------------------------------------- risk over time

/** Normal distribution, P(X <= z). Accurate to about 1e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// The shaded range holds 8 in 10 readings: 1.2816 standard deviations each side.
const Z80 = 1.2816;

/** Chance that the sugar at this moment is above 180 (spike) or below 70 (low). */
export function chanceAt(p: ForecastPoint, kind: 'spike' | 'low'): number {
  if (kind === 'spike') {
    const sd = (p.high - p.mid) / Z80;
    return sd > 0 ? normalCdf((p.mid - RANGE_HIGH) / sd) : p.mid > RANGE_HIGH ? 1 : 0;
  }
  const sd = (p.mid - p.low) / Z80;
  return sd > 0 ? normalCdf((RANGE_LOW - p.mid) / sd) : p.mid < RANGE_LOW ? 1 : 0;
}

/** Which risk the chart shows: the bigger one of the hour. */
export function riskKind(points: ForecastPoint[]): 'spike' | 'low' {
  const top = (k: 'spike' | 'low') => Math.max(0, ...points.map((p) => chanceAt(p, k)));
  return top('low') > top('spike') ? 'low' : 'spike';
}

/** The highest (spike) or lowest (low) point ahead of now. */
export function extreme(points: ForecastPoint[], kind: 'spike' | 'low'): ForecastPoint {
  const ahead = points.filter((p) => p.minute > 0);
  return ahead.reduce((a, b) => (kind === 'spike' ? (b.mid > a.mid ? b : a) : b.mid < a.mid ? b : a), ahead[0] ?? points[0]);
}

/**
 * Chart scale that follows the expected line, so a rise is steep and easy to
 * see. The shaded range may run past the top; 70 and 180 are always shown.
 */
export function focusRange(points: ForecastPoint[], past: number[] = []): [number, number] {
  const mids = [...points.map((p) => p.mid), ...past];
  const lows = points.map((p) => p.low);
  const lo = Math.min(RANGE_LOW, ...mids, ...lows);
  const hi = Math.max(RANGE_HIGH, ...mids);
  const span = hi - lo;
  return [Math.max(30, Math.floor((lo - Math.max(10, span * 0.08)) / 10) * 10), Math.ceil((hi + Math.max(30, span * 0.25)) / 10) * 10];
}
