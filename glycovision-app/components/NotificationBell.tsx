// components/NotificationBell.tsx
//
// Bell button for the header: opens the notification centre, shows the
// unread count as a red badge, and gives a small ring animation when a
// new notification arrives.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { colors, shadow } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { subscribeInbox, unreadCount } from '@/lib/inbox';

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const prev = useRef<number | null>(null);
  const swing = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(
    () =>
      subscribeInbox((items) => {
        const n = unreadCount(items);
        // Ring only when the count goes up (a new notification), not on load.
        if (prev.current != null && n > prev.current) {
          swing.setValue(0);
          Animated.sequence([
            Animated.timing(swing, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(swing, { toValue: -1, duration: 140, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(swing, { toValue: 0.6, duration: 120, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(swing, { toValue: -0.4, duration: 110, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(swing, { toValue: 0, duration: 100, easing: Easing.linear, useNativeDriver: true }),
          ]).start();
          pop.setValue(0.4);
          Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 14 }).start();
        }
        prev.current = n;
        setCount(n);
      }),
    [swing, pop],
  );

  const label = count ? `Notifications, ${count} unread` : 'Notifications';
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        router.push('/notifications');
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.btn, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Animated.View
        style={{
          transform: [{ rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }],
        }}
      >
        <Ionicons name={count ? 'notifications' : 'notifications-outline'} size={22} color={colors.text} />
      </Animated.View>
      {count > 0 ? (
        <Animated.View style={[styles.badge, { transform: [{ scale: pop }] }]}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
