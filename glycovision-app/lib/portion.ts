// lib/portion.ts
//
// A photo cannot show how much food there is, so the user picks a
// quantity in the dish's natural unit (rotis, plates, cups) and nutrition
// is scaled from the backend's values, which describe `basis_grams`.

export interface PortionInfo {
  unit: string; // "roti", "plate"
  unit_plural: string; // "rotis", "plates"
  unit_grams: number; // typical weight of one unit
  kind: "count" | "amount"; // counted pieces vs plates/bowls/cups
  basis_grams: number; // weight the nutrition values describe
}

export interface MealNutrition {
  carbs: number;
  protein: number;
  fat: number;
  calories: number;
}

// Largest quantity accepted from the grams box (3 kg).
export const MAX_PORTION_GRAMS = 3000;

export function isPortionInfo(value: unknown): value is PortionInfo {
  const p = value as PortionInfo;
  return (
    !!p &&
    typeof p.unit === "string" &&
    typeof p.unit_plural === "string" &&
    Number.isFinite(p.unit_grams) &&
    p.unit_grams > 0 &&
    Number.isFinite(p.basis_grams) &&
    p.basis_grams > 0 &&
    (p.kind === "count" || p.kind === "amount")
  );
}

// Quick choices: whole pieces for counted food, halves for plates/bowls.
export function quickMultipliers(portion: PortionInfo): number[] {
  return portion.kind === "count" ? [1, 2, 3, 4] : [0.5, 1, 1.5, 2];
}

function formatAmount(multiplier: number): string {
  const whole = Math.floor(multiplier);
  const half = Math.abs(multiplier - whole - 0.5) < 1e-9;
  if (half) return whole === 0 ? "½" : `${whole}½`;
  return Number.isInteger(multiplier)
    ? String(multiplier)
    : String(Math.round(multiplier * 10) / 10);
}

// "½ plate", "1 plate", "1½ plates", "3 rotis"
export function portionLabel(portion: PortionInfo, multiplier: number): string {
  const unit = multiplier <= 1 ? portion.unit : portion.unit_plural;
  return `${formatAmount(multiplier)} ${unit}`;
}

// Description of any gram amount, e.g. "2 rotis (about 120 g)" or
// "about 175 g" when it is not a clean multiple of the unit.
export function describePortion(portion: PortionInfo, grams: number): string {
  const multiplier = grams / portion.unit_grams;
  const step = portion.kind === "count" ? 1 : 0.5;
  const isClean =
    Math.abs(multiplier / step - Math.round(multiplier / step)) < 1e-6 &&
    multiplier > 0;
  const roundedGrams = Math.round(grams);
  return isClean
    ? `${portionLabel(portion, multiplier)} (about ${roundedGrams} g)`
    : `about ${roundedGrams} g`;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

// Nutrition for `grams` of food, scaled from values for basis_grams.
export function scaleNutrition(
  base: MealNutrition,
  portion: PortionInfo,
  grams: number,
): MealNutrition {
  const factor = grams / portion.basis_grams;
  return {
    carbs: round1(base.carbs * factor),
    protein: round1(base.protein * factor),
    fat: round1(base.fat * factor),
    calories: Math.round(base.calories * factor),
  };
}

// Parse the grams box; null if empty or out of range.
export function parseGrams(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  if (!text.trim() || !Number.isFinite(value)) return null;
  if (value <= 0 || value > MAX_PORTION_GRAMS) return null;
  return value;
}
