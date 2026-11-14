// components/ui/Button.tsx
//
// One button for the whole app. Large (56 px) by default so it is easy to
// hit for patients with reduced dexterity; every button gets a spoken
// label for screen readers.

import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedPressable } from '@/components/ui/AnimatedPressable';
import { Text } from '@/components/ui/Typography';
import { colors, radius } from '@/constants/theme';
import { haptic } from '@/lib/haptics';

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'success' | 'onHero' | 'onHeroOutline';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'lg' | 'md';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  // Outer touch area; put flex: 1 here when buttons share a row.
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: '#FFFFFF' },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary },
  dark: { bg: colors.ink, fg: '#FFFFFF' },
  success: { bg: colors.success, fg: '#FFFFFF' },
  // On the light hero card: solid blue main action, white outlined secondary.
  onHero: { bg: colors.primary, fg: '#FFFFFF' },
  onHeroOutline: { bg: '#FFFFFF', fg: colors.primary, border: colors.border },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  style,
  containerStyle,
  accessibilityHint,
}: ButtonProps) {
  const p = palette[variant];
  const inactive = disabled || loading;

  return (
    <AnimatedPressable
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      disabled={inactive}
      containerStyle={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        styles.base,
        size === 'md' && styles.md,
        { backgroundColor: p.bg },
        p.border ? { borderWidth: 1.5, borderColor: p.border } : null,
        inactive && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={size === 'md' ? 18 : 20} color={p.fg} /> : null}
          <Text style={[styles.label, size === 'md' && styles.labelMd, { color: p.fg }]}>{label}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.button,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  md: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 17, fontWeight: '700' },
  labelMd: { fontSize: 15.5 },
  disabled: { opacity: 0.45 },
});
