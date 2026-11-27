// lib/medicines.ts
// Small pure helpers for the Medicines screen.

import type { MedicineDose } from '@/services/api';

export const STATE_TEXT: Record<MedicineDose['state'], string> = {
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Not marked',
  due: 'Due now',
  later: 'Later',
};

/** "08:00" -> "8:00 AM" in the phone's style. */
export function showTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Move a time by some minutes, around midnight. */
export function shiftTime(hhmm: string, by: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m + by + 24 * 60) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** A sensible next time of day that isn't used yet. */
export function nextTime(times: string[]): string {
  for (const t of ['08:00', '20:00', '14:00', '22:00', '11:00', '17:00']) if (!times.includes(t)) return t;
  let t = '06:00';
  while (times.includes(t)) t = shiftTime(t, 15);
  return t;
}

/** One line for Home. Null when there is nothing to say today. */
export function todayLine(today: MedicineDose[]): { text: string; attention: boolean } | null {
  if (!today.length) return null;
  const done = today.filter((d) => d.state === 'taken').length;
  const open = today.filter((d) => d.state === 'due' || d.state === 'missed');
  if (open.length) return { text: `${open[0].name}, ${showTime(open[0].time)}: ${open[0].state === 'due' ? 'due now' : 'not marked yet'}`, attention: true };
  const next = today.find((d) => d.state === 'later');
  return { text: next ? `Next: ${next.name}, ${showTime(next.time)}` : `${done} of ${today.length} taken today`, attention: false };
}

/** Mealtime insulin belongs in Bolus, where active insulin is counted. */
export function looksLikeInsulin(name: string): boolean {
  return /insulin|novorapid|humalog|apidra|fiasp|actrapid|humulin|lantus|tresiba|levemir|toujeo|mixtard|novomix|ryzodeg|basaglar|insuget/i.test(name);
}
