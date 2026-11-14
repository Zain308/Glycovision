// lib/glucose.ts: the status words a patient sees for a reading.
import { glucoseStatus, greeting, timeAgo, RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';

describe('glucoseStatus boundaries (international time-in-range consensus)', () => {
  test.each([
    [40, 'very_low'], [53, 'very_low'], [53.9, 'very_low'],
    [54, 'low'], [69, 'low'], [69.9, 'low'],
    [70, 'in_range'], [120, 'in_range'], [180, 'in_range'],
    [180.1, 'high'], [250, 'high'],
    [250.1, 'very_high'], [599, 'very_high'],
  ])('%p mg/dL -> %s', (value, key) => {
    expect(glucoseStatus(value)?.key).toBe(key);
  });

  test('range constants', () => {
    expect([RANGE_LOW, RANGE_HIGH]).toEqual([70, 180]);
  });

  test.each([null, undefined, NaN, Infinity, -Infinity])('no status for %p', (v) => {
    expect(glucoseStatus(v as number)).toBeNull();
  });

  test('every status has words, tone and advice (not colour alone)', () => {
    for (const v of [40, 60, 120, 200, 300]) {
      const s = glucoseStatus(v)!;
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.advice.length).toBeGreaterThan(10);
      expect(s.icon).toBeTruthy();
    }
  });

  test('lows are danger, never success', () => {
    expect(glucoseStatus(60)!.tone).toBe('danger');
    expect(glucoseStatus(45)!.tone).toBe('danger');
  });

  test('negative or impossible values', () => {
    // WEAKNESS check: a negative reading is classified instead of rejected.
    expect(glucoseStatus(-20)).toBeNull();
  });
});

describe('timeAgo', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  test.each([
    [0, 'Just now'], [5, '5 min ago'], [59, '59 min ago'], [60, '1 h ago'], [180, '3 h ago'],
  ])('%p minutes', (m, txt) => expect(timeAgo(ago(m))).toBe(txt));

  test('older than a day shows a date', () => {
    expect(timeAgo(ago(60 * 30))).not.toMatch(/ago/);
  });

  test.each([null, undefined, '', 'not a date'])('invalid %p -> null', (v) => {
    expect(timeAgo(v as string)).toBeNull();
  });

  test('future timestamps never show negative minutes', () => {
    expect(timeAgo(new Date(Date.now() + 10 * 60000).toISOString())).toBe('Just now');
  });
});

describe('greeting', () => {
  const at = (h: number) => {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
  };
  test.each([[6, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [16, 'Good afternoon'], [17, 'Good evening'], [23, 'Good evening'], [2, 'Good morning']])(
    '%p:00 -> %s',
    (h, g) => expect(greeting(at(h))).toBe(g),
  );
});
