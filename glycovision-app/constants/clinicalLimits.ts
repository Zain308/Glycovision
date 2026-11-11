// constants/clinicalLimits.ts
//
// Must match the backend's ProfileUpdateRequest / PatientState limits in
// glycovision-backend/models/schemas.py. Keeping them in one place stops
// screens from accepting values the server will reject.

export const LIMITS = {
  // ICR: grams of carbs covered by 1 unit (exclusive bounds).
  icr: { min: 1, max: 50 },
  // ISF: mg/dL drop per unit (exclusive bounds).
  isf: { min: 5, max: 150 },
  // Target BG in mg/dL (exclusive bounds).
  targetBg: { min: 70, max: 180 },
  // Duration of insulin action in hours (inclusive bounds). Below 3 h the
  // insulin-on-board curve is invalid; rapid-acting insulin lasts 3-8 h.
  diaHours: { min: 3, max: 8 },
} as const;

export function validateClinicalSettings(values: {
  icr: number;
  isf: number;
  targetBg: number;
  diaHours: number;
}): string | null {
  const { icr, isf, targetBg, diaHours } = values;

  if (![icr, isf, targetBg, diaHours].every(Number.isFinite)) {
    return "Please enter valid numbers for all clinical settings.";
  }
  if (icr <= LIMITS.icr.min || icr >= LIMITS.icr.max) {
    return `ICR must be greater than ${LIMITS.icr.min} and less than ${LIMITS.icr.max}.`;
  }
  if (isf <= LIMITS.isf.min || isf >= LIMITS.isf.max) {
    return `ISF must be greater than ${LIMITS.isf.min} and less than ${LIMITS.isf.max} mg/dL per unit.`;
  }
  if (targetBg <= LIMITS.targetBg.min || targetBg >= LIMITS.targetBg.max) {
    return `Target BG must be greater than ${LIMITS.targetBg.min} and less than ${LIMITS.targetBg.max} mg/dL.`;
  }
  if (diaHours < LIMITS.diaHours.min || diaHours > LIMITS.diaHours.max) {
    return `Insulin duration (DIA) must be between ${LIMITS.diaHours.min} and ${LIMITS.diaHours.max} hours.`;
  }
  return null;
}
