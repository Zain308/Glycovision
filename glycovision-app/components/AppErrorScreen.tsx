// components/AppErrorScreen.tsx
//
// Shown by the router's error boundary when a screen crashes: a calm
// message and a "Try again" button instead of a red error screen.
// Technical details stay hidden behind a tap (for bug reports).

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { colors, radius } from '@/constants/theme';

export function AppErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const [details, setDetails] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.wrap} style={{ backgroundColor: colors.bg }}>
      <View style={styles.icon}>
        <Ionicons name="medkit" size={36} color={colors.primary} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Something went wrong
      </Text>
      <Text style={styles.body}>
        This screen hit a problem. Your data is safe. Try again, and if it keeps happening, restart the app.
      </Text>
      <Button label="Try again" icon="refresh" onPress={() => retry()} containerStyle={{ alignSelf: 'stretch' }} />
      <Pressable onPress={() => setDetails((d) => !d)} style={styles.detailsBtn} accessibilityRole="button">
        <Text style={styles.detailsLink}>{details ? 'Hide details' : 'Show details'}</Text>
      </Pressable>
      {details ? <Text style={styles.details}>{String(error?.message ?? error)}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 14 },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  body: { fontSize: 16, lineHeight: 24, color: colors.textMuted, textAlign: 'center', marginBottom: 6 },
  detailsBtn: { padding: 8 },
  detailsLink: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  details: {
    fontSize: 13,
    color: colors.textFaint,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: 12,
    alignSelf: 'stretch',
  },
});
