// lib/report.ts
// Builds the doctor's report as a printable page (A4). Facts only: no advice,
// no diagnosis, no dose. Everything typed by the user is escaped.

import type { DoctorReport } from '@/services/api';

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const dash = (v: unknown, unit = '') => (v === null || v === undefined || v === '' ? '–' : `${esc(v)}${unit}`);
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The consensus colours of a time-in-range bar, with the words and numbers
// beside it, so it also reads in black and white.
const RANGES = [
  ['very_high', 'Very high, above 250', '#E07B10'],
  ['high', 'High, 181–250', '#F2B25B'],
  ['in_range', 'In range, 70–180', '#12A06E'],
  ['low', 'Low, 54–69', '#E0393B'],
  ['very_low', 'Very low, below 54', '#8E1B1D'],
] as const;

export function rangeBar(g: DoctorReport['glucose']): string {
  let y = 0;
  const bars = RANGES.map(([key, , color]) => {
    const h = ((g[key] ?? 0) / 100) * 150;
    const rect = h > 0 ? `<rect x="0" y="${y.toFixed(1)}" width="44" height="${Math.max(1, h - 1).toFixed(1)}" fill="${color}"/>` : '';
    y += h;
    return rect;
  }).join('');
  const rows = RANGES.map(([key, label, color]) => `<tr><td><span class="sw" style="background:${color}"></span>${label} mg/dL</td><td class="n">${g[key] ?? 0}%</td></tr>`).join('');
  return `<div class="tir"><svg width="44" height="150" viewBox="0 0 44 150">${bars}</svg><table class="plain">${rows}</table></div>`;
}

export function dailyChart(g: DoctorReport['glucose']): string {
  const days = g.daily ?? [];
  if (days.length < 2) return '';
  const W = 680;
  const H = 170;
  const top = Math.min(400, Math.max(200, ...days.map((d) => d.max)) + 10);
  const low = Math.max(30, Math.min(60, ...days.map((d) => d.min)) - 5);
  const x = (i: number) => 40 + (i + 0.5) * ((W - 50) / days.length);
  const y = (v: number) => 8 + (1 - (Math.min(top, Math.max(low, v)) - low) / (top - low)) * (H - 34);
  const step = Math.ceil(days.length / 10);
  return `<svg width="100%" viewBox="0 0 ${W} ${H}">
    <rect x="40" y="${y(180)}" width="${W - 50}" height="${y(70) - y(180)}" fill="#E3F7EF"/>
    ${[70, 180].map((v) => `<text x="34" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#4E5C72">${v}</text>`).join('')}
    ${days
      .map(
        (d, i) => `<line x1="${x(i)}" x2="${x(i)}" y1="${y(d.max)}" y2="${y(d.min)}" stroke="#9DB7DE" stroke-width="5" stroke-linecap="round"/>
      <circle cx="${x(i)}" cy="${y(d.average)}" r="4" fill="#1657BE"/>
      ${i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#4E5C72">${new Date(`${d.day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}</text>` : ''}`,
      )
      .join('')}
  </svg><p class="s">Dot: day's average. Bar: lowest to highest. Green band: 70–180 mg/dL.</p>`;
}

export function reportHtml(r: DoctorReport): string {
  const g = r.glucose;
  const p = r.patient;
  const v = r.vitals;
  const about: [string, string][] = [
    ['Age / sex', `${dash(p.age)} / ${dash(p.sex)}`],
    ['Diabetes', dash(p.diabetes_type)],
    ['Weight / BMI', `${dash(p.weight_kg, ' kg')} / ${dash(p.bmi)}`],
    ['HbA1c (lab)', v.hba1c ? `${esc(v.hba1c.value)}% on ${day(v.hba1c.at)}` : '–'],
    ['Blood pressure', v.blood_pressure ? `${esc(Math.round(v.blood_pressure.value))}/${esc(Math.round(v.blood_pressure.value2 ?? 0))} on ${day(v.blood_pressure.at)}` : '–'],
  ];
  if (p.mealtime_insulin) about.push(['Carb ratio / sensitivity / target', `${dash(p.icr, ' g/u')} / ${dash(p.isf, ' mg/dL/u')} / ${dash(p.target_bg)}`]);
  const numbers: [string, string][] = g.count
    ? [
        ['Average sugar', `${g.average} mg/dL`],
        ['Readings', `${g.count} on ${g.days} of ${r.period.days} days`],
        ['Lowest / highest', `${g.lowest} / ${g.highest}`],
        ['Variation (CV)', dash(g.cv, '%')],
        ...(g.gmi ? ([['GMI (sensor)', `${g.gmi}%`]] as [string, string][]) : []),
      ]
    : [];
  const habits: [string, string][] = [
    ['Mealtime insulin logged', r.insulin.per_day != null ? `${r.insulin.per_day} units a day (${r.insulin.days} days with entries)` : 'none logged'],
    ['Carbs logged', r.meals.carbs_per_day != null ? `${r.meals.carbs_per_day} g a day (${r.meals.days} days with entries)` : 'none logged'],
    ['Steps', r.activity.steps_per_day != null ? `${r.activity.steps_per_day.toLocaleString()} a day (${r.activity.days} days)` : 'no data'],
    ['Medicines taken, last 7 days', r.adherence.percent != null ? `${r.adherence.taken} of ${r.adherence.planned} doses (${r.adherence.percent}%)` : 'none tracked'],
    ...(r.stress ? ([['Stress (voice checks, experimental)', esc(r.stress)]] as [string, string][]) : []),
  ];
  const table = (rows: [string, string][]) => `<table class="kv">${rows.map(([k, x]) => `<tr><td>${esc(k)}</td><td>${x}</td></tr>`).join('')}</table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>GlycoVision report</title><style>
  @page { size: A4; margin: 8mm }
  * { box-sizing: border-box }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #0D1A2E; font-size: 12.5px; line-height: 1.45; margin: 0; padding: 6mm }
  h1 { font-size: 21px; margin: 0 } h2 { font-size: 14.5px; margin: 18px 0 6px; border-bottom: 1px solid #D5DEEA; padding-bottom: 3px; page-break-after: avoid }
  .s { color: #4E5C72; font-size: 11px; margin: 4px 0 } .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1657BE; padding-bottom: 8px }
  table { border-collapse: collapse; width: 100% } .kv td { padding: 3px 0; vertical-align: top } .kv td:first-child { color: #4E5C72; width: 42% }
  .grid td, .grid th { border: 1px solid #D5DEEA; padding: 4px 7px; text-align: left } .grid th { background: #F0F4FA } .n { text-align: right; font-variant-numeric: tabular-nums }
  .grid .n { text-align: right } .two { display: flex; gap: 28px } .two > div { flex: 1 } .tir { display: flex; gap: 14px; align-items: center } .plain td { padding: 3px 0 }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px } tr, svg { page-break-inside: avoid }
  .foot { margin-top: 18px; border-top: 1px solid #D5DEEA; padding-top: 6px; color: #4E5C72; font-size: 10.5px }
  </style></head><body>
  <div class="top"><div><h1>${p.name ? esc(p.name) : 'Patient'}</h1><div class="s">Diabetes report, ${day(r.period.from)} to ${day(r.period.to)} (${r.period.days} days)</div></div><div class="s">GlycoVision · made ${when(r.made_at)}</div></div>
  <div class="two"><div><h2>Patient</h2>${table(about)}</div><div><h2>Blood sugar</h2>${numbers.length ? table(numbers) : '<p>No readings in this period.</p>'}</div></div>
  ${
    g.count
      ? `<h2>${g.sensor ? 'Time in range' : 'Readings in range'}</h2>${rangeBar(g)}
  ${g.sensor ? '' : '<p class="s">From single readings, so these are shares of readings, not of time. No GMI is given without sensor data.</p>'}
  <h2>Day by day</h2>${dailyChart(g)}
  <h2>By time of day</h2><table class="grid"><tr><th>Time</th><th class="n">Readings</th><th class="n">Average</th><th class="n">Below 70</th><th class="n">Above 180</th></tr>
  ${(g.by_part ?? []).map((b) => `<tr><td>${esc(b.part)}</td><td class="n">${b.count}</td><td class="n">${dash(b.average)}</td><td class="n">${b.low}</td><td class="n">${b.high}</td></tr>`).join('')}</table>
  ${g.low_events?.length ? `<h2>Low readings (below 70)</h2><p>${g.low_events.map((e) => `${e.value} on ${when(e.at)}`).join(' · ')}</p>` : ''}`
      : ''
  }
  <h2>Medicines</h2>${
    r.medicines.length
      ? `<table class="grid"><tr><th>Name</th><th>Dose</th><th>Times</th><th>Note</th></tr>${r.medicines
          .map((m) => `<tr><td>${esc(m.name)}</td><td>${dash(m.dose)}</td><td>${m.times.length ? esc(m.times.join(', ')) : 'when needed'}</td><td>${dash(m.note)}</td></tr>`)
          .join('')}</table>`
      : '<p>None entered.</p>'
  }
  <h2>Daily habits</h2>${table(habits)}
  <div class="foot">Made from the patient's own entries and devices in GlycoVision, a student research app. Entries may be missing or wrong; not checked by a clinician. It gives no diagnosis and no treatment advice.</div>
  </body></html>`;
}
