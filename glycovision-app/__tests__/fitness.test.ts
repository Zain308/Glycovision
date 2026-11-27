/// <reference types="jest" />
// Helpers behind the Fitness tab, Health Connect sync and live workouts.
jest.mock('@/services/api', () => ({ syncHealth: jest.fn(), getFitness: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/config', () => ({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k', API_URL: 'https://y' }));
jest.mock('@/lib/notifications', () => ({ moveReminder: jest.fn() }));
jest.mock('expo-background-task', () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 } }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn() }));

import { average, clockTime, distanceFromSteps, formatMetric, metricValue, minutesText, niceTop, pace, workoutKcal, WORKOUTS } from '@/lib/fitness';
import { goodVital, largest, minuteActivity, recorderSamples, withNow, sleepMinutes, workoutName } from '@/lib/healthConnect';
import { perMinute, toPoints } from '@/lib/stepRecorder';
import { shouldRemind } from '@/lib/backgroundSync';

const t = (min: number) => new Date(Date.UTC(2026, 10, 23, 9, min)).toISOString();
const day = (o: object) => ({ day: '2026-11-23', steps: null, distance_m: null, active_kcal: null, move_min: null, heart_pts: null, active_hours: null, longest_sit_min: null, hr_min: null, hr_max: null, hr_resting: null, ...o });

describe('minute activity', () => {
  test('Move Minutes and Heart Points by cadence', () => {
    const rows = minuteActivity([
      { time: t(0), steps: 29 },
      { time: t(1), steps: 30 },
      { time: t(2), steps: 100 },
      { time: t(3), steps: 130 },
      { time: t(7), steps: 99 },
    ]);
    expect(rows).toEqual([
      { kind: 'move_min', time: t(0), value: 3 },
      { kind: 'move_min', time: t(5), value: 1 },
      { kind: 'heart_pts', time: t(0), value: 3 },
    ]);
  });
  test('never more than 5 minutes or 10 points in a bucket', () => {
    const rows = minuteActivity(Array.from({ length: 8 }, () => ({ time: t(1), steps: 140 })));
    expect(rows.map((r) => r.value)).toEqual([5, 10]);
  });
});

describe('Health Connect records', () => {
  test('workout names', () => {
    const types = { WALKING: 79, RUNNING: 56, CRICKET: 14 };
    expect(workoutName(79, types)).toBe('Walking');
    expect(workoutName(14, types)).toBe('Cricket');
    expect(workoutName(999, types, ' Kabaddi ')).toBe('Kabaddi');
    expect(workoutName(999, types)).toBe('Workout');
  });
  test('sleep stages', () => {
    const s = (stage: number, a: number, b: number) => ({ stage, startTime: t(a), endTime: t(b) });
    expect(sleepMinutes([s(5, 0, 20), s(6, 20, 30), s(1, 30, 35), s(3, 35, 40), s(4, 40, 60)])).toEqual({ deep_min: 20, rem_min: 10, awake_min: 10 });
    expect(sleepMinutes()).toEqual({ deep_min: 0, rem_min: 0, awake_min: 0 });
  });
  test('one odd value must not block the whole sync', () => {
    expect(goodVital({ kind: 'weight', value: 70, time: t(0) })).toBe(true);
    expect(goodVital({ kind: 'weight', value: NaN, time: t(0) })).toBe(false);
    expect(goodVital({ kind: 'blood_pressure', value: 120, value2: 80, time: t(0) })).toBe(true);
    expect(goodVital({ kind: 'blood_pressure', value: 80, value2: 120, time: t(0) })).toBe(false);
  });
});

describe('fitness helpers', () => {
  test('missing days are not zero', () => {
    const days = [day({ steps: 4000 }), day({}), day({ steps: 6000 })];
    expect(average(days, 'steps')).toBe(5000);
    expect(average([day({})], 'steps')).toBeNull();
    expect(formatMetric(null, 'steps')).toBe('–');
    expect(metricValue(day({ distance_m: 2500 }), 'distance_m')).toBe(2.5);
  });
  test('chart top is round and covers the value', () => {
    expect(niceTop(8300)).toBe(10000);
    expect(niceTop(22)).toBe(25);
    expect(niceTop(0)).toBe(10);
    for (const v of [1, 7, 99, 1234, 56789]) expect(niceTop(v)).toBeGreaterThanOrEqual(v);
  });
  test('times', () => {
    expect(minutesText(95)).toBe('1 h 35 min');
    expect(minutesText(120)).toBe('2 h');
    expect(minutesText(null)).toBe('–');
    expect(clockTime(65)).toBe('01:05');
    expect(clockTime(3725)).toBe('1:02:05');
  });
  test('pace, distance and calories', () => {
    expect(pace(300, 180)).toEqual({ perMinute: 100, label: 'Brisk' });
    expect(pace(10, 5).perMinute).toBe(0);
    expect(distanceFromSteps(1000, 170)).toBe(704);
    expect(distanceFromSteps(1000, null)).toBe(700);
    expect(workoutKcal(WORKOUTS[0].met, 70, 1800)).toBe(116);
    expect(workoutKcal(3, null, 1800)).toBeNull();
  });
  test('move reminders: an hour of sitting, at most once an hour', () => {
    const now = 10 * 3600 * 1000;
    expect(shouldRemind(75, 0, now)).toBe(true);
    expect(shouldRemind(45, 0, now)).toBe(false);
    expect(shouldRemind(null, 0, now)).toBe(false);
    expect(shouldRemind(75, now - 1800 * 1000, now)).toBe(false);
  });
});

describe('all-day step counter', () => {
  const at = (min: number, sec = 0) => Date.UTC(2026, 10, 23, 9, min, sec);
  test('reads the phone’s list and drops bad points', () => {
    expect(toPoints([at(5), at(6), 80, at(1), at(2), 90, at(3), at(4), 0, at(9), at(8), 50])).toEqual([
      { start: at(1), end: at(2), steps: 90 },
      { start: at(5), end: at(6), steps: 80 },
    ]);
    expect(toPoints([])).toEqual([]);
  });
  test('a long point is spread out and no step is lost', () => {
    const m = perMinute([{ start: at(0, 30), end: at(3), steps: 250 }]);
    expect([...m.values()].map(Math.round)).toEqual([50, 100, 100]);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(250);
    const one = perMinute([{ start: at(0), end: at(0), steps: 4 }]);
    expect([...one.values()]).toEqual([4]);
  });
  test('samples keep the total and never invent running', () => {
    const rows = recorderSamples([{ start: at(0), end: at(60), steps: 600 }], at(0));
    const steps = rows.filter((r) => r.kind === 'steps');
    expect(steps.length).toBe(12);
    expect(steps.reduce((t, r) => t + r.value, 0)).toBe(600);
    expect(rows.some((r) => r.kind === 'heart_pts')).toBe(false);
  });
  test('brisk walking earns Heart Points', () => {
    const rows = recorderSamples([{ start: at(0), end: at(10), steps: 1100 }], at(0));
    expect(rows.filter((r) => r.kind === 'heart_pts').reduce((t, r) => t + r.value, 0)).toBe(10);
  });
  test('phone and watch are never added together', () => {
    const t0 = new Date(at(0)).toISOString();
    const out = largest([
      { kind: 'steps', time: t0, value: 300 },
      { kind: 'steps', time: t0, value: 340 },
      { kind: 'heart_rate', time: t0, value: 80 },
    ]);
    expect(out).toEqual([
      { kind: 'steps', time: t0, value: 340 },
      { kind: 'heart_rate', time: t0, value: 80 },
    ]);
  });
  test('sitting still is data: a zero for now, unless you are walking', () => {
    expect(withNow([], at(7))).toEqual([{ kind: 'steps', time: new Date(at(5)).toISOString(), value: 0 }]);
    const walking = [{ kind: 'steps' as const, time: new Date(at(5)).toISOString(), value: 40 }];
    expect(withNow(walking, at(7))).toBe(walking);
  });
});
