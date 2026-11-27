/// <reference types="jest" />
// Medicines, the doctor's report, and imported blood sugar.
jest.mock('@/services/api', () => ({ syncHealth: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/config', () => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k', API_URL: 'https://y' }));

import { looksLikeInsulin, nextTime, shiftTime, todayLine } from '@/lib/medicines';
import { medicineTimes } from '@/lib/notifications';
import { freshReading, goodGlucose } from '@/lib/healthConnect';
import { dailyChart, esc, rangeBar, reportHtml } from '@/lib/report';
import type { DoctorReport, MedicineDose } from '@/services/api';

const dose = (time: string, state: MedicineDose['state'], name = 'Metformin'): MedicineDose => ({ medicine_id: 1, name, dose: null, time, state });

describe('medicines', () => {
  test('times move around midnight', () => {
    expect(shiftTime('00:00', -15)).toBe('23:45');
    expect(shiftTime('23:50', 15)).toBe('00:05');
    expect(nextTime(['08:00'])).toBe('20:00');
    expect(nextTime(['08:00', '20:00', '14:00', '22:00', '11:00', '17:00'])).toBe('06:00');
  });
  test('one reminder per time names every medicine', () => {
    expect(medicineTimes([{ name: 'A', times: ['20:00', '08:00'] }, { name: 'B', times: ['08:00'] }])).toEqual([
      { time: '08:00', names: ['A', 'B'] },
      { time: '20:00', names: ['A'] },
    ]);
  });
  test('home line', () => {
    expect(todayLine([])).toBeNull();
    expect(todayLine([dose('08:00', 'due')])?.attention).toBe(true);
    expect(todayLine([dose('08:00', 'taken'), dose('20:00', 'later')])?.text).toContain('Next: Metformin');
    expect(todayLine([dose('08:00', 'taken'), dose('20:00', 'skipped')])?.text).toBe('1 of 2 taken today');
  });
  test('insulin is recognised', () => {
    expect(looksLikeInsulin('NovoRapid pen')).toBe(true);
    expect(looksLikeInsulin('Metformin')).toBe(false);
  });
});

describe('blood sugar from a meter or sensor', () => {
  const now = Date.UTC(2026, 10, 24, 9, 0);
  const at = (min: number, value: number) => ({ time: new Date(now - min * 60000).toISOString(), value });
  test('odd values are left out', () => {
    expect(goodGlucose([at(1, 120), at(2, NaN), at(3, 5), at(4, 900)])).toEqual([at(1, 120)]);
  });
  test('only a fresh reading can alert', () => {
    expect(freshReading([at(40, 60), at(5, 64.4)], now)).toBe(64);
    expect(freshReading([at(40, 60)], now)).toBeNull();
    expect(freshReading([], now)).toBeNull();
  });
});

const REPORT: DoctorReport = {
  period: { days: 14, from: '2026-11-11', to: '2026-11-24' },
  patient: { name: 'A <script>alert(1)</script>', diabetes_type: 'Type 2', sex: null, age: 45, height_cm: 170, weight_kg: 80, bmi: 27.7, icr: null, isf: null, target_bg: null, insulin_type: null, mealtime_insulin: false },
  glucose: {
    count: 20, days: 10, per_day: 2, average: 151, sd: 40, cv: 26.5, lowest: 62, highest: 260, very_low: 0, low: 5, in_range: 70, high: 20, very_high: 5, sensor: false, gmi: null,
    daily: [{ day: '2026-11-11', average: 150, min: 90, max: 210, count: 2 }, { day: '2026-11-12', average: 152, min: 62, max: 260, count: 2 }],
    by_part: [{ part: 'Morning', average: 150, count: 20, low: 1, high: 5 }], low_events: [{ value: 62, at: '2026-11-12T04:00:00+05:00' }],
  },
  insulin: { doses: 0, per_day: null, days: 0 }, meals: { count: 3, carbs_per_day: 120, days: 2 }, activity: { days: 5, steps_per_day: 4200, heart_pts: 30 },
  vitals: { hba1c: { value: 7.4, value2: null, at: '2026-10-01T00:00:00Z' }, weight: null, blood_pressure: null },
  medicines: [{ id: 1, name: 'Met"formin', dose: '500 mg', times: ['08:00'], note: '<b>x</b>' }],
  adherence: { taken: 6, planned: 7, percent: 86, days: 7 }, stress: null, made_at: '2026-11-24T09:00:00Z',
};

describe('doctor report', () => {
  const html = reportHtml(REPORT);
  test('text typed by the user can never become code', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  test('finger-pricks are called readings, never time in range or GMI', () => {
    expect(html).toContain('Readings in range');
    expect(html).not.toContain('Time in range');
    expect(html).not.toContain('GMI (sensor)');
    expect(reportHtml({ ...REPORT, glucose: { ...REPORT.glucose, sensor: true, gmi: 6.9 } })).toContain('GMI (sensor)');
  });
  test('has the main facts and the disclaimer', () => {
    for (const t of ['151 mg/dL', '7.4%', '500 mg', '6 of 7 doses', 'no diagnosis and no treatment advice']) expect(html).toContain(t);
  });
  test('works with nothing logged', () => {
    const empty = reportHtml({ ...REPORT, glucose: { count: 0 }, medicines: [], adherence: { taken: 0, planned: 0, percent: null, days: 7 } });
    expect(empty).toContain('No readings in this period');
    expect(empty).not.toMatch(/undefined|NaN|null/);
    expect(html).not.toMatch(/undefined|NaN|null/);
  });
  test('charts stay inside their box', () => {
    const heights = [...rangeBar(REPORT.glucose).matchAll(/height="([\d.]+)" fill/g)].map((m) => Number(m[1]));
    expect(heights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(150);
    expect(dailyChart({ count: 1, daily: [] })).toBe('');
  });
});
