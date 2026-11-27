// constants/theme.ts
// GlycoVision design tokens (v2). Screens take colours, type, spacing and
// radii from here instead of hard-coding them.
//
// Design goals (from diabetes-app usability research): large readable
// type for older patients, high-contrast text (no light grey on white),
// one clear hero number per screen, big tap targets (>= 48 px), and
// green / amber / red reserved for glucose status only.

export const colors = {
  // Surfaces: white on a barely-blue background, like paper in daylight.
  bg: '#F5F8FD',
  card: '#FFFFFF',
  surfaceMuted: '#F0F4FA', // grouped rows, tiles, skeletons
  input: '#F2F6FB', // filled inputs
  border: '#E4EAF3',
  divider: '#EEF2F7',

  // Brand: calm medical blue for actions, links and selected states.
  primary: '#1E6FE8', // 4.7:1 on white
  primaryDark: '#1657BE', // pressed
  primarySoft: '#E6F0FE', // icon circles, chips, active tab
  primaryPale: '#F3F8FF',

  // Hero surface: a soft blue-to-white gradient with dark text (no heavy
  // dark blocks). heroGradient is drawn by Card variant="hero".
  hero: '#EAF2FF',
  heroGradient: ['#E3EEFF', '#F7FAFF'] as const,
  heroRaised: 'rgba(30,111,232,0.08)',
  heroText: '#0D1A2E',
  heroMuted: '#4E5C72',

  // Text: every text colour passes WCAG AA on card and bg.
  text: '#0D1A2E', // titles, values
  textMuted: '#4E5C72', // body, labels (7.0:1)
  textFaint: '#6A778C', // captions, hints (4.6:1)
  ink: '#0D1A2E', // dark button

  // Status: glucose and safety. Always paired with an icon and words.
  success: '#12A06E',
  successText: '#05704B',
  successSoft: '#E3F7EF',
  warning: '#E07B10',
  warningText: '#93450A',
  warningSoft: '#FFF3E3',
  danger: '#E0393B',
  dangerText: '#A81E20',
  dangerSoft: '#FDEDED',
  info: '#0B93B8',
  infoSoft: '#E1F5FA',

  // Data accents
  carbs: '#E07B10',
  insulin: '#1E6FE8',
  heart: '#B8408F', // Heart Points; checked against primary for colour blindness
};

// Plus Jakarta Sans, loaded in app/_layout.tsx. Use these instead of fontWeight:
// on Android a custom font ignores fontWeight, so each weight is its own
// font file. components/ui/Typography.tsx maps fontWeight automatically.
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

export const radius = {
  sm: 10,
  md: 14, // inputs, tiles
  button: 16,
  lg: 22, // cards
  xl: 28, // hero, sheets
  pill: 999,
};

// Type scale. Nothing below 13 px; body is 16 px for older readers.
export const type = {
  display: { fontSize: 56, fontWeight: '800' as const, color: colors.text, letterSpacing: -1.5 },
  title: { fontSize: 28, fontWeight: '800' as const, color: colors.text, letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: '800' as const, color: colors.text },
  sectionTitle: { fontSize: 18, fontWeight: '800' as const, color: colors.text },
  body: { fontSize: 16, color: colors.textMuted, lineHeight: 24 },
  bodyStrong: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  label: { fontSize: 14, color: colors.textMuted, fontWeight: '600' as const },
  metricValue: { fontSize: 26, fontWeight: '800' as const, color: colors.text },
  caption: { fontSize: 13, color: colors.textFaint, lineHeight: 18 },
  overline: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.textFaint,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
};

// Numbers that line up (glucose, doses, macros).
export const tabular = { fontVariant: ['tabular-nums' as const] };

export const shadow = {
  card: {
    shadowColor: '#1E4E9C',
    shadowOpacity: 0.07,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#1E4E9C',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};

// Minimum touch target (WCAG 2.5.8 / platform guidance).
export const TOUCH = 48;

// Shared building blocks so every screen's inputs and buttons match.
export const ui = {
  input: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 54,
    fontSize: 17,
    color: colors.text,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.textMuted,
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    minHeight: 56,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700' as const,
  },
};
