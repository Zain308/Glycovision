/// <reference types="jest" />
// The chart joins readings with a line only when they are less than 3 h
// apart; longer gaps are drawn dashed ("no readings here").
import { MAX_GAP_MS, splitIntoRuns } from '@/components/GlucoseChart';

const H = 60 * 60 * 1000;
const at = (...hours: number[]) => hours.map((h) => ({ t: h * H }));

test('close readings form one run', () => {
  expect(splitIntoRuns(at(0, 1, 2.5, 3))).toHaveLength(1);
});

test('a gap longer than 3 h starts a new run', () => {
  const runs = splitIntoRuns(at(0, 1, 6, 7, 12));
  expect(runs.map((r) => r.length)).toEqual([2, 2, 1]);
});

test('exactly 3 h apart stays joined', () => {
  expect(MAX_GAP_MS).toBe(3 * H);
  expect(splitIntoRuns(at(0, 3))).toHaveLength(1);
});

test('empty input gives no runs', () => {
  expect(splitIntoRuns([])).toEqual([]);
});
