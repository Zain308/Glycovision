// components/ui/Card.tsx
import React from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, shadow } from '@/constants/theme';

type Variant = 'elevated' | 'flat' | 'tint' | 'hero';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // elevated: white, soft shadow and hairline border (default) · flat:
  // white, border only · tint: pale blue · hero: soft blue-to-white
  // gradient for the screen's main number.
  variant?: Variant;
}

const variants: Record<Exclude<Variant, 'hero'>, ViewStyle> = {
  elevated: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  flat: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  tint: { backgroundColor: colors.primaryPale, borderWidth: 1, borderColor: colors.primarySoft },
};

export function Card({ children, style, variant = 'elevated' }: CardProps) {
  if (variant === 'hero') {
    const flat = StyleSheet.flatten(style) ?? {};
    const r = (flat.borderRadius as number | undefined) ?? radius.xl;
    return (
      <View style={[styles.base, styles.heroShell, { borderRadius: r }, style]}>
        <LinearGradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: r }]}
        />
        {children}
      </View>
    );
  }
  return <View style={[styles.base, variants[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, padding: 18, marginBottom: 14 },
  heroShell: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D6E5FD',
    backgroundColor: colors.hero,
    ...shadow.card,
  },
});
