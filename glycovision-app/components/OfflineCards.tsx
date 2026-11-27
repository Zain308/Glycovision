// components/OfflineCards.tsx
// Home without internet: one status row, and what still works in place of the
// forecast. Never shows an old forecast or dose.

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { colors, radius } from '@/constants/theme';
import { useOffline } from '@/lib/offline';
import { sameDay } from '@/lib/offlineView';
import type { TimelineEvent } from '@/services/api';

export function copyTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  return sameDay(at, now)
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function OfflineRow() {
  const { offline, waiting, problems, savedAt } = useOffline();
  if (!offline && !waiting.length && !problems.length && savedAt == null) return null;
  const bad = problems.length > 0 || (!offline && waiting.some((e) => e.note));
  const lines = [
    offline ? (savedAt ? `No internet. Data from ${copyTime(savedAt)}` : 'No internet') : savedAt ? `Slow connection. Data from ${copyTime(savedAt)}` : null,
    waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'entry' : 'entries'} saved on this phone, waiting to upload` : null,
    !offline && waiting.some((e) => e.note) ? `The server can't take ${waiting.length === 1 ? 'it' : 'them'} yet: ${waiting.find((e) => e.note)!.note}` : null,
    bad ? `${problems.length} ${problems.length === 1 ? 'entry' : 'entries'} could not be uploaded` : null,
  ].filter(Boolean) as string[];
  return (
    <Pressable
      onPress={() => router.push('/my-data' as any)}
      accessibilityRole="button"
      accessibilityLabel={`${lines.join('. ')}. Open details`}
      style={({ pressed }) => [styles.row, bad && { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={offline ? 'cloud-offline-outline' : bad ? 'alert-circle-outline' : 'cloud-upload-outline'} size={22} color={bad ? colors.warningText : colors.primary} />
      <View style={{ flex: 1 }}>
        {lines.map((l, i) => (
          <Text key={l} style={i === 0 ? styles.title : styles.text}>
            {l}
          </Text>
        ))}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
    </Pressable>
  );
}

export function OfflinePlan({ events }: { events: TimelineEvent[] }) {
  const insulin = events.filter((e) => e.type === 'insulin').slice(0, 3);
  return (
    <View>
      <Text style={styles.head}>Your forecast needs internet</Text>
      <Text style={styles.text}>An old forecast or insulin dose could be wrong, so none is shown. Keep logging: it all counts when you are back online.</Text>
      {insulin.length ? (
        <View style={styles.box}>
          <Text style={styles.label}>Insulin logged today</Text>
          {insulin.map((e) => (
            <Text key={e.logged_at} style={styles.item}>
              {e.title} at {copyTime(new Date(e.logged_at).getTime())}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={[styles.text, { marginTop: 12 }]}>Works now: logging sugar, food, insulin, medicines and activity, low-sugar help, the food library and reminders.</Text>
      <Text style={[styles.text, { marginTop: 6 }]}>For insulin, follow the plan your doctor gave you.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  text: { fontSize: 14.5, lineHeight: 20, color: colors.textMuted },
  head: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 4 },
  box: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 12, marginTop: 12 },
  label: { fontSize: 13.5, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  item: { fontSize: 15.5, fontWeight: '700', color: colors.text, lineHeight: 22 },
});
