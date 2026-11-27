// lib/body.ts
// BMI and BMR, matching glycovision-backend/services/body_metrics.py.

export function bmiFrom(heightCm: number, weightKg: number): number | null {
  if (!(heightCm >= 80 && heightCm <= 250) || !(weightKg >= 15 && weightKg <= 350)) return null;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}

/** WHO action points for Asian adults (23 and 27.5). */
export function bmiLabel(bmi: number): string {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 23) return 'healthy weight';
  if (bmi < 27.5) return 'overweight';
  return 'obese';
}

/** Mifflin-St Jeor, adults only. */
export function bmrFrom(sex: 'male' | 'female' | null, age: number | null, heightCm: number, weightKg: number): number | null {
  if (!sex || age === null || age < 18 || age > 120 || bmiFrom(heightCm, weightKg) === null) return null;
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161));
}

export function validateBody(v: { height: number; weight: number; year: number; sex: string | null }): string | null {
  if (!(v.height >= 80 && v.height <= 250)) return 'Enter your height in cm, between 80 and 250.';
  if (!(v.weight >= 15 && v.weight <= 350)) return 'Enter your weight in kg, between 15 and 350.';
  const age = new Date().getFullYear() - v.year;
  if (!(age >= 1 && age <= 120)) return 'Enter the year you were born, for example 2001.';
  if (!v.sex) return 'Choose male or female, used for the BMR calculation.';
  return null;
}
