// components/TabBar.tsx
//
// Floating tab bar with a raised Scan button in the middle: the app's
// most frequent action gets the biggest, most central target. Labels
// stay visible under every icon (icons alone are hard to learn).
//
// Expo Router SDK 58 passes `emitter` and `navigateToTab` to a custom tab
// bar (not `navigation`); the props are typed so a mismatch fails the
// type check instead of crashing on tap.

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';

import { Text } from '@/components/ui/Typography';
import { colors, shadow } from '@/constants/theme';
import { haptic } from '@/lib/haptics';

type TabDef = {
  label: string;
  icon: (focused: boolean, color: string) => React.ReactNode;
};

const TABS: Record<string, TabDef> = {
  index: {
    label: 'Home',
    icon: (f, c) => <Ionicons name={f ? 'home' : 'home-outline'} size={23} color={c} />,
  },
  bolus: {
    label: 'Bolus',
    icon: (f, c) => <MaterialCommunityIcons name={f ? 'needle' : 'needle'} size={24} color={c} />,
  },
  scanner: {
    label: 'Scan',
    icon: () => <Ionicons name="scan" size={28} color="#FFFFFF" />,
  },
  voice: {
    label: 'Voice',
    icon: (f, c) => <Ionicons name={f ? 'mic' : 'mic-outline'} size={24} color={c} />,
  },
  profile: {
    label: 'Profile',
    icon: (f, c) => <Ionicons name={f ? 'person' : 'person-outline'} size={23} color={c} />,
  },
};

// One tab: the highlight pill fades and grows in when it becomes active.
function TabItem({
  def,
  focused,
  onPress,
}: {
  def: TabDef;
  focused: boolean;
  onPress: () => void;
}) {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
  }, [focused, anim]);

  const color = focused ? colors.primary : colors.textFaint;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={def.label}
      accessibilityState={{ selected: focused }}
      style={styles.item}
    >
      <View style={styles.iconWrap}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.pill,
            { opacity: anim, transform: [{ scaleX: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
          ]}
        />
        {def.icon(focused, color)}
      </View>
      <Text style={[styles.label, { color }]}>{def.label}</Text>
    </Pressable>
  );
}

export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const scanScale = useRef(new Animated.Value(1)).current;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const def = TABS[route.name];
          if (!def) return null;
          const focused = state.index === index;

          const onPress = () => {
            haptic.select();
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };

          if (route.name === 'scanner') {
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                onPressIn={() => Animated.spring(scanScale, { toValue: 0.92, useNativeDriver: true, speed: 40 }).start()}
                onPressOut={() => Animated.spring(scanScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start()}
                accessibilityRole="button"
                accessibilityLabel="Scan a meal"
                accessibilityState={{ selected: focused }}
                style={styles.scanSlot}
              >
                <Animated.View style={[styles.scanBtn, { transform: [{ scale: scanScale }] }]}>
                  {def.icon(focused, '#fff')}
                </Animated.View>
                <Text style={[styles.label, { color: focused ? colors.primary : colors.textFaint }]}>{def.label}</Text>
              </Pressable>
            );
          }

          return <TabItem key={route.key} def={def} focused={focused} onPress={onPress} />;
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.card,
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
    shadowOpacity: 0.1,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 56, gap: 3 },
  iconWrap: {
    width: 56,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: { borderRadius: 16, backgroundColor: colors.primarySoft },
  label: { fontSize: 12.5, fontWeight: '700' },
  scanSlot: { flex: 1, alignItems: 'center', gap: 3 },
  scanBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: colors.bg,
    ...shadow.raised,
  },
});
