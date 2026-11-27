// components/OfflineBanner.tsx
//
// A short message from the top: the internet is gone, an entry was kept on the
// phone, everything is uploaded, or we are back online. It leaves by itself so
// it never covers the screen; Home keeps a permanent row.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Typography';
import { colors, radius, shadow } from '@/constants/theme';
import { useOffline, type OfflineState } from '@/lib/offline';

const SHOW_MS = 4000;
type Message = { text: string; tone: 'dark' | 'good'; icon: 'cloud-offline' | 'phone-portrait' | 'checkmark-circle' };

/** What changed, in words. Pure, for tests. */
export function bannerMessage(before: OfflineState, now: OfflineState): Message | null {
  if (now.offline && now.waiting.length > before.waiting.length) return { text: 'Saved on your phone. Uploads when you’re online.', tone: 'dark', icon: 'phone-portrait' };
  if (now.offline && !before.offline) return { text: 'No internet. You can keep logging.', tone: 'dark', icon: 'cloud-offline' };
  if (!now.offline && before.offline) return { text: now.waiting.length ? 'Back online. Uploading…' : 'Back online', tone: 'good', icon: 'checkmark-circle' };
  // Something that had to wait, not an entry that went straight through.
  if (!now.offline && before.waiting.some((e) => e.tries > 1) && !now.waiting.length && now.problems.length === before.problems.length)
    return { text: 'Everything is uploaded', tone: 'good', icon: 'checkmark-circle' };
  return null;
}

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const now = useOffline();
  const before = useRef(now);
  const [message, setMessage] = useState<Message | null>(null);
  const [shown, setShown] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const next = bannerMessage(before.current, now);
    before.current = now;
    if (!next) return;
    setMessage(next);
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), SHOW_MS);
  }, [now]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    Animated.spring(slide, { toValue: shown ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
  }, [shown, slide]);

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
      {message ? (
        <View style={[styles.pill, { backgroundColor: message.tone === 'dark' ? colors.ink : colors.success }]}>
          <Ionicons name={message.icon} size={18} color="#fff" />
          <Text style={styles.text}>{message.text}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  text: { color: '#fff', fontSize: 14.5, fontWeight: '700', flexShrink: 1 },
});
