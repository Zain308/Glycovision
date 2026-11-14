// lib/portion.ts (how much was eaten -> carbs) and clinical limits.
import {
  describePortion,
  isPortionInfo,
  parseGrams,
  portionLabel,
  quickMultipliers,
  scaleNutrition,
  MAX_PORTION_GRAMS,
  type PortionInfo,
} from '@/lib/portion';
import { LIMITS, validateClinicalSettings } from '@/constants/clinicalLimits';

const roti: PortionInfo = { unit: 'roti', unit_plural: 'rotis', unit_grams: 60, kind: 'count', basis_grams: 100 };
const plate: PortionInfo = { unit: 'plate', unit_plural: 'plates', unit_grams: 250, kind: 'amount', basis_grams: 100 };
const per100 = { carbs: 35.6, protein: 5.9, fat: 3.6, calories: 202 };

describe('scaleNutrition', () => {
  test('one roti (60 g) from per-100 g values', () => {
    expect(scaleNutrition(per100, roti, 60)).toEqual({ carbs: 21.4, protein: 3.5, fat: 2.2, calories: 121 });
  });
  test('scales linearly', () => {
    const one = scaleNutrition(per100, roti, 60).carbs;
    expect(scaleNutrition(per100, roti, 180).carbs).toBeCloseTo(one * 3, 0);
  });
  test('zero grams -> zero', () => {
    expect(scaleNutrition(per100, roti, 0).carbs).toBe(0);
  });
  test('result is never NaN', () => {
    const r = scaleNutrition(per100, { ...roti, basis_grams: 100 }, 37.5);
    Object.values(r).forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
});

describe('labels', () => {
  test.each([
    [plate, 0.5, '½ plate'], [plate, 1, '1 plate'], [plate, 1.5, '1½ plates'], [plate, 2, '2 plates'],
    [roti, 1, '1 roti'], [roti, 3, '3 rotis'],
  ])('%#', (p, m, txt) => expect(portionLabel(p as PortionInfo, m as number)).toBe(txt));

  test('clean multiples describe the unit', () => {
    expect(describePortion(roti, 120)).toBe('2 rotis (about 120 g)');
    expect(describePortion(plate, 375)).toBe('1½ plates (about 375 g)');
  });
  test('odd grams fall back to grams', () => {
    expect(describePortion(roti, 75)).toBe('about 75 g');
  });
  test('quick choices', () => {
    expect(quickMultipliers(roti)).toEqual([1, 2, 3, 4]);
    expect(quickMultipliers(plate)).toEqual([0.5, 1, 1.5, 2]);
  });
});

describe('parseGrams', () => {
  test.each([['120', 120], ['12.5', 12.5], ['12,5', 12.5], [' 80 ', 80], [String(MAX_PORTION_GRAMS), MAX_PORTION_GRAMS]])(
    'valid %p', (t, v) => expect(parseGrams(t as string)).toBe(v),
  );
  test.each(['', ' ', 'abc', '0', '-5', '3001', 'NaN', 'Infinity', '1e9'])('invalid %p', (t) => {
    expect(parseGrams(t)).toBeNull();
  });
});

describe('isPortionInfo guards bad backend data', () => {
  test('accepts a real portion', () => expect(isPortionInfo(roti)).toBe(true));
  test.each([null, undefined, {}, { ...roti, unit_grams: 0 }, { ...roti, basis_grams: -1 }, { ...roti, kind: 'cups' }, { ...roti, unit_grams: NaN }])(
    'rejects %#', (v) => expect(isPortionInfo(v)).toBe(false),
  );
});

describe('validateClinicalSettings mirrors the backend', () => {
  const ok = { icr: 10, isf: 50, targetBg: 110, diaHours: 4 };
  test('valid profile passes', () => expect(validateClinicalSettings(ok)).toBeNull());
  test.each([
    ['icr', LIMITS.icr.min], ['icr', LIMITS.icr.max], ['isf', LIMITS.isf.min], ['isf', LIMITS.isf.max],
    ['targetBg', LIMITS.targetBg.min], ['targetBg', LIMITS.targetBg.max], ['diaHours', 2.9], ['diaHours', 8.1],
    ['icr', NaN], ['isf', Infinity],
  ])('%s = %p rejected', (k, v) => {
    expect(validateClinicalSettings({ ...ok, [k as string]: v })).not.toBeNull();
  });
  test.each([['diaHours', 3], ['diaHours', 8]])('%s = %p allowed (inclusive)', (k, v) => {
    expect(validateClinicalSettings({ ...ok, [k as string]: v })).toBeNull();
  });
});
