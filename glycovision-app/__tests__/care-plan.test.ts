/// <reference types="jest" />
// Helpers behind the new plan: forecast wording, BMI/BMR, Health Connect
// buckets and the Google redirect.
jest.mock('@/services/api', () => ({ syncHealth: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/config', () => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k', API_URL: 'https://y' }));

import { chanceAt, changeLabel, chartRange, confidence, crossing, crossingText, extreme, focusRange, normalCdf, riskKind } from '@/lib/forecast';
import { assumesTreatment, curveAt, effectChip, lineWidth, linkFor, waterfall } from '@/lib/flow';
import { bmiFrom, bmiLabel, bmrFrom, validateBody } from '@/lib/body';
import { dayChunks, floor5, withRestingSteps } from '@/lib/healthConnect';
import { readRedirect } from '@/lib/googleSignIn';

const line = (...mids: number[]) => mids.map((mid, i) => ({ minute: i * 5, low: mid - 20, mid, high: mid + 20 }));

describe('forecast helpers', () => {
  test('finds when sugar passes 180', () => {
    expect(crossing(line(160, 170, 190))).toEqual({ minute: 8, limit: 180 });
    expect(crossingText(line(160, 170, 190))).toBe('May pass 180 in about 8 minutes');
  });
  test('finds when sugar drops below 70', () => {
    expect(crossing(line(90, 75, 65))?.limit).toBe(70);
  });
  test('coming back into range is not a warning', () => {
    expect(crossing(line(200, 190, 170))).toBeNull();
    expect(crossing(line(60, 65, 75))).toBeNull();
  });
  test('chart always shows 70 and 180 and the whole range', () => {
    const [lo, hi] = chartRange(line(120, 125));
    expect(lo).toBeLessThan(70);
    expect(hi).toBeGreaterThan(180);
    expect(chartRange(line(300, 380))[1]).toBeGreaterThanOrEqual(400);
  });
  test('change wording', () => {
    expect(changeLabel({ direction: 'up', change_60: 38.4 }).text).toBe('Up 38');
    expect(changeLabel({ direction: 'down', change_60: -25 }).text).toBe('Down 25');
    expect(changeLabel({ direction: 'steady', change_60: 6 }).text).toBe('Steady');
  });
  test('one reading is never called steady', () => {
    expect(changeLabel({ direction: 'steady', change_60: 1, based_on: 'single' }).text).toBe('Not clear yet');
  });
  test('a likely spike or low is never called steady', () => {
    expect(changeLabel({ direction: 'up', change_60: 5, range_60: [131, 253] }).text).toBe('Up to 253');
    expect(changeLabel({ direction: 'down', change_60: 3, range_60: [56, 161] }).text).toBe('Down to 56');
  });
  test('one reading is always called rough', () => {
    expect(confidence('single').label).toMatch(/Rough/);
    expect(confidence('single_watch').hint).toBeTruthy();
    expect(confidence('cgm').hint).toBeNull();
  });
});

describe('body', () => {
  test('matches the server', () => {
    expect(bmiFrom(170, 70)).toBe(24.2);
    expect(bmiLabel(24.2)).toBe('overweight');
    expect(bmrFrom('male', 30, 170, 70)).toBe(1618);
  });
  test('no adult BMR for children, nothing for typos', () => {
    expect(bmrFrom('male', 12, 150, 40)).toBeNull();
    expect(bmiFrom(17, 70)).toBeNull();
    expect(bmiFrom(NaN, 70)).toBeNull();
  });
  test('validation', () => {
    const ok = { height: 170, weight: 70, year: 2000, sex: 'male' };
    expect(validateBody(ok)).toBeNull();
    expect(validateBody({ ...ok, height: 1.7 })).toMatch(/cm/);
    expect(validateBody({ ...ok, year: 20 })).toMatch(/year/);
    expect(validateBody({ ...ok, sex: null })).toMatch(/male or female/);
  });
});

describe('Health Connect', () => {
  test('5-minute buckets and day chunks', () => {
    expect(floor5(Date.UTC(2026, 10, 23, 9, 7, 30))).toBe(Date.UTC(2026, 10, 23, 9, 5));
    const day = 24 * 3600 * 1000;
    expect(dayChunks(0, 2.5 * day)).toEqual([[0, day], [day, 2 * day], [2 * day, 2.5 * day]]);
  });
  test('heart rate without steps means at rest', () => {
    const out = withRestingSteps([
      { kind: 'heart_rate', time: '2026-11-23T09:00:00Z', value: 90 },
      { kind: 'heart_rate', time: '2026-11-23T09:05:00Z', value: 95 },
      { kind: 'steps', time: '2026-11-23T09:05:00Z', value: 300 },
      { kind: 'active_kcal', time: '2026-11-23T09:05:00Z', value: 0 },
    ]);
    expect(out.filter((s) => s.kind === 'steps').map((s) => s.value).sort((a, b) => a - b)).toEqual([0, 300]);
    expect(out.some((s) => s.kind === 'active_kcal')).toBe(false);
  });
});

test('Google redirect', () => {
  expect(readRedirect('glycovisionapp://auth?code=abc')).toEqual({ code: 'abc' });
  expect(readRedirect('glycovisionapp://auth?error=access_denied&error_description=No+thanks').error).toBe('No thanks');
});

describe('connected plan', () => {
  const f = { current_bg: 168, change_60: 73, direction: 'up' as const, effects: { trend: 21, food: 39, insulin: 0, stress: 12, movement: 1 } };
  test('bars add up to the forecast', () => {
    const bars = waterfall(f);
    expect(bars.map((b) => b.label)).toEqual(['Now', 'Sugar', 'Food', 'Stress', 'Activity', '1 hour']);
    expect(bars[bars.length - 1].value).toBe(168 + 73);
    for (let i = 2; i < bars.length - 1; i++) expect(bars[i].from).toBe(bars[i - 1].to);
  });
  test('a likely low is never explained with a plus', () => {
    expect(assumesTreatment({ direction: 'down', change_60: -6 })).toBe(true);
    expect(assumesTreatment({ direction: 'down', change_60: -40 })).toBe(false);
    expect(waterfall({ ...f, direction: 'down', change_60: -6 })).toEqual([]);
  });
  test('effect text and thickness', () => {
    expect(effectChip({ effect: 18 })).toBe('+18');
    expect(effectChip({ effect: -5 })).toBe('−5');
    expect(effectChip({ effect: 0 })).toBeNull();
    expect(effectChip({ effect: null })).toBeNull();
    expect(lineWidth(null)).toBe(2);
    expect(lineWidth(-40)).toBe(lineWidth(40));
    expect(lineWidth(400)).toBe(8);
  });
  test('lines start at the input and end at the forecast', () => {
    expect(curveAt(0, 30, 160, 66)).toEqual({ x: 30, y: 2 });
    expect(curveAt(1, 30, 160, 66)).toEqual({ x: 160, y: 66 });
  });
  test('finds the link between an input and a result', () => {
    const links = [{ from: 'stress' as const, to: 'insulin' as const, text: 'Never used.', used: false }];
    expect(linkFor(links, 'stress', 'insulin')?.used).toBe(false);
    expect(linkFor(links, 'food', 'insulin')).toBeUndefined();
  });
});

describe('spike picture', () => {
  const pt = (minute: number, low: number, mid: number, high: number) => ({ minute, low, mid, high });
  const spike = [pt(0, 168, 168, 168), pt(15, 173, 189, 217), pt(30, 180, 208, 286), pt(60, 188, 241, 367)];
  const low = [pt(0, 84, 84, 84), pt(30, 52, 69, 103), pt(60, 40, 78, 141)];

  test('normal curve', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.2816)).toBeCloseTo(0.9, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  test('chance at each moment follows the shaded range', () => {
    // The top of the range is the 90th percentile.
    expect(chanceAt(pt(30, 100, 150, 180), 'spike')).toBeCloseTo(0.1, 2);
    expect(chanceAt(pt(30, 70, 120, 170), 'low')).toBeCloseTo(0.1, 2);
    expect(chanceAt(pt(0, 200, 200, 200), 'spike')).toBe(1);
    expect(chanceAt(pt(0, 120, 120, 120), 'spike')).toBe(0);
    const rising = spike.map((p) => chanceAt(p, 'spike'));
    expect([...rising].sort((a, b) => a - b)).toEqual(rising);
  });
  test('shows the bigger risk, and its peak or lowest point', () => {
    expect(riskKind(spike)).toBe('spike');
    expect(riskKind(low)).toBe('low');
    expect(extreme(spike, 'spike')).toMatchObject({ minute: 60, mid: 241 });
    expect(extreme(low, 'low')).toMatchObject({ minute: 30, mid: 69 });
  });
  test('scale follows the line, not the far end of the range', () => {
    const [lo, hi] = focusRange(spike);
    expect(lo).toBeLessThanOrEqual(70);
    expect(hi).toBeGreaterThan(241);
    expect(hi).toBeLessThan(367);
    expect(focusRange(low)[0]).toBeLessThanOrEqual(40);
  });
});
