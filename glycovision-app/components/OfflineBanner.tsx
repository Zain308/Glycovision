// components/OfflineBanner.tsx
//
// Slides down from the top when the phone loses internet, so the user
// knows why data is not loading (instead of thinking the app is broken),
// and confirms briefly when the connection is back.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Typography';
import { colors, radius, shadow } from '@/constants/theme';

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'online' | 'offline' | 'back'>('online');
  const slide = useRef(new Animated.Value(0)).current;
  const wasOffline = useRef(false);

  useEffect(() => {
    let backTimer: ReturnType<typeof setTimeout> | undefined;
    const unsub = NetInfo.addEventListener((s) => {
      // isInternetReachable can be null while unknown: treat as online.
      const offline = s.isConnected === false || s.isInternetReachable === false;
      if (offline) {
        wasOffline.current = true;
        setState('offline');
      } else if (wasOffline.current) {
        wasOffline.current = false;
        setState('back');
        clearTimeout(backTimer);
        backTimer = setTimeout(() => setState('online'), 2500);
      }
    });
    return () => {
      unsub();
      clearTimeout(backTimer);
    };
  }, []);

  useEffect(() => {
    Animated.spring(slide, { toValue: state === 'online' ? 0 : 1, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
  }, [state, slide]);

  const offline = state === 'offline';
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          top: insets.top + 6,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }) }],
        },
      ]}
    >
      <View style={[styles.pill, { backgroundColor: offline ? colors.ink : colors.success }]}>
        <Ionicons name={offline ? 'cloud-offline' : 'checkmark-circle'} size={18} color="#fff" />
        <Text style={styles.text}>
          {offline ? "You're offline. Showing your last data." : 'Back online'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  text: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
});
