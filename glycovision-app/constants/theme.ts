// constants/theme.ts
export const colors = {
  bg: '#F8F7FF',
  card: '#FFFFFF',
  primary: '#7C3AED',
  primarySoft: '#EDE9FE',
  primaryPale: '#F5F3FF',
  text: '#111827',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  border: '#E5E7EB',
  surfaceMuted: '#F3F4F6',
  success: '#059669',
  successSoft: '#ECFDF5',
  warning: '#D97706',
  danger: '#EF4444',
  dangerSoft: '#FEE2E2',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 30,
};

export const type = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.textMuted, lineHeight: 22 },
  label: { fontSize: 13, color: colors.textMuted, fontWeight: '600' as const },
  metricValue: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  caption: { fontSize: 12, color: colors.textFaint },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
};