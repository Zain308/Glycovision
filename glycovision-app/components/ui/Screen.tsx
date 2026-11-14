// components/ui/Screen.tsx
//
// Standard screen: safe-area aware scroll view with a consistent header
// (title, optional subtitle, optional right-hand element). Replaces the
// hard-coded "marginTop: 40" each screen used before.

import React, { useCallback, useRef } from 'react';
import { Animated, Easing, RefreshControl, ScrollView, StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Text } from '@/components/ui/Typography';
import { colors, type } from '@/constants/theme';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  // Rendered above the title (e.g. a greeting line).
  eyebrow?: string;
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  // Rendered above the header (e.g. the brand row on Home).
  top?: React.ReactNode;
}

export function Screen({
  title,
  subtitle,
  right,
  eyebrow,
  children,
  refreshing,
  onRefresh,
  contentStyle,
  scroll = true,
  top,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  // Gentle fade-and-rise each time the screen comes into view, so moving
  // between tabs feels smooth instead of an abrupt swap.
  const enter = useRef(new Animated.Value(0)).current;
  useFocusEffect(
    useCallback(() => {
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        // If anything interrupts the entrance (e.g. a quick re-render or
        // re-focus), never leave the screen half-faded.
        if (!finished) enter.setValue(1);
      });
      return () => enter.setValue(1);
    }, [enter]),
  );
  const enterStyle = {
    opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  const header =
    title || right ? (
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          {title ? (
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    ) : null;

  const padding = {
    paddingTop: insets.top + 12,
    paddingBottom: insets.bottom + 120, // room above the floating tab bar
    paddingHorizontal: 20,
  };

  if (!scroll) {
    return (
      <Animated.View style={[styles.container, padding, contentStyle, enterStyle]}>
        <LinearGradient colors={['#DCEBFF', 'rgba(245,248,253,0)']} style={styles.glow} pointerEvents="none" />
        {top}
        {header}
        {children}
      </Animated.View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      {/* Soft blue glow behind the top of the screen */}
      <LinearGradient
        colors={['#DCEBFF', 'rgba(245,248,253,0)']}
        style={styles.glow}
        pointerEvents="none"
      />
      <Animated.View style={enterStyle}>
        {top}
        {header}
        {children}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 340 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  eyebrow: { fontSize: 15, color: colors.textMuted, fontWeight: '600', marginBottom: 2 },
  title: type.title,
  subtitle: { fontSize: 15.5, color: colors.textMuted, marginTop: 4, lineHeight: 22 },
});
