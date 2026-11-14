// lib/glucose.ts
// Plain-language glucose status shared by the home screen, chart and
// logging sheet. Thresholds follow the international consensus on time
// in range (Battelino et al., Diabetes Care 2019): 70-180 mg/dL target,
// below 54 very low, above 250 very high.

import type { Tone } from '@/components/ui/Bits';

export type GlucoseStatus = {
  key: 'very_low' | 'low' | 'in_range' | 'high' | 'very_high';
  label: string;
  tone: Tone;
  icon: 'alert-circle' | 'arrow-down-circle' | 'checkmark-circle' | 'arrow-up-circle';
  advice: string;
};

export const RANGE_LOW = 70;
export const RANGE_HIGH = 180;

export function glucoseStatus(value: number | null | undefined): GlucoseStatus | null {
  // Zero or negative is not a real reading (a typo or a bad sensor value):
  // show no status rather than "Very low".
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value < 54)
    return {
      key: 'very_low',
      label: 'Very low',
      tone: 'danger',
      icon: 'alert-circle',
      advice: 'Treat a low now with fast sugar, then check again in 15 minutes.',
    };
  if (value < RANGE_LOW)
    return {
      key: 'low',
      label: 'Low',
      tone: 'danger',
      icon: 'arrow-down-circle',
      advice: 'Have 15 g of fast sugar and check again in 15 minutes.',
    };
  if (value <= RANGE_HIGH)
    return {
      key: 'in_range',
      label: 'In range',
      tone: 'success',
      icon: 'checkmark-circle',
      advice: 'Your sugar is in the target range.',
    };
  if (value <= 250)
    return {
      key: 'high',
      label: 'High',
      tone: 'warning',
      icon: 'arrow-up-circle',
      advice: 'Above target. Follow your care plan and check again later.',
    };
  return {
    key: 'very_high',
    label: 'Very high',
    tone: 'danger',
    icon: 'alert-circle',
    advice: 'Well above target. Follow your care plan; check ketones if advised.',
  };
}

// "Just now", "12 min ago", "3 h ago", or a date for older readings.
export function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
