// app/notifications.tsx
//
// Notification centre (the bell): every alert and reminder, newest first,
// grouped into Today / Earlier with unread dots. Tap to open the related
// screen; mark all read; clear; shortcut to reminder settings.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { IconBadge, SectionHeader, type Tone } from '@/components/ui/Bits';
import { Reveal } from '@/components/ui/Motion';
import { colors, radius } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { timeAgo } from '@/lib/glucose';
import {
  clearInbox,
  markAllRead,
  markRead,
  subscribeInbox,
  unreadCount,
  type InboxItem,
  type InboxKind,
} from '@/lib/inbox';

const KIND: Record<InboxKind, { tone: Tone; icon: (c: string, s: number) => React.ReactNode }> = {
  low: { tone: 'danger', icon: (c, s) => <Ionicons name="arrow-down-circle" size={s} color={c} /> },
  high: { tone: 'warning', icon: (c, s) => <Ionicons name="arrow-up-circle" size={s} color={c} /> },
  meal: { tone: 'warning', icon: (c, s) => <Ionicons name="restaurant" size={s} color={c} /> },
  risk: { tone: 'brand', icon: (c, s) => <Ionicons name="trending-up" size={s} color={c} /> },
  reminder: { tone: 'info', icon: (c, s) => <Ionicons name="alarm" size={s} color={c} /> },
  timer: { tone: 'danger', icon: (c, s) => <Ionicons name="timer" size={s} color={c} /> },
  info: { tone: 'brand', icon: (c, s) => <MaterialCommunityIcons name="hand-wave" size={s} color={c} /> },
};

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function Row({ item }: { item: InboxItem }) {
  const k = KIND[item.kind] ?? KIND.info;
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        markRead(item.id);
        router.push(item.url as any);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}`}
      style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && { opacity: 0.75 }]}
    >
      <IconBadge tone={k.tone} size={42} renderIcon={k.icon} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>
          {item.body}
        </Text>
      </View>
      {!item.read ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  useEffect(() => subscribeInbox(setItems), []);

  const unread = items ? unreadCount(items) : 0;
  const today = useMemo(() => (items ?? []).filter((x) => isToday(x.createdAt)), [items]);
  const earlier = useMemo(() => (items ?? []).filter((x) => !isToday(x.createdAt)), [items]);

  return (
    <Screen
      title="Notifications"
      subtitle={unread ? `${unread} new` : 'You are all caught up'}
      right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => router.push('/reminders')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Reminder settings"
            style={styles.circleBtn}
          >
            <Ionicons name="settings-outline" size={21} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={styles.circleBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
      }
    >
      {items && items.length > 0 ? (
        <>
          {unread > 0 ? (
            <View style={styles.actions}>
              <Button
                label="Mark all as read"
                icon="checkmark-done"
                size="md"
                variant="secondary"
                onPress={() => {
                  haptic.success();
                  markAllRead();
                }}
                containerStyle={{ flex: 1 }}
              />
            </View>
          ) : null}

          {today.length > 0 ? (
            <Reveal index={0}>
              <SectionHeader title="Today" />
              <Card style={styles.list}>
                {today.map((it) => (
                  <Row key={it.id} item={it} />
                ))}
              </Card>
            </Reveal>
          ) : null}

          {earlier.length > 0 ? (
            <Reveal index={1}>
              <SectionHeader title="Earlier" />
              <Card style={styles.list}>
                {earlier.map((it) => (
                  <Row key={it.id} item={it} />
                ))}
              </Card>
            </Reveal>
          ) : null}

          <Pressable
            onPress={() => clearInbox()}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Clear all notifications"
          >
            <Text style={styles.clearText}>Clear all</Text>
          </Pressable>
        </>
      ) : items ? (
        <Reveal>
          <Card style={styles.empty}>
            <IconBadge icon="notifications-outline" tone="brand" size={64} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyBody}>
              Alerts about your sugar and your daily reminders will show up here.
            </Text>
            <Button label="Set up reminders" icon="alarm-outline" onPress={() => router.push('/reminders')} containerStyle={{ alignSelf: 'stretch' }} />
          </Card>
        </Reveal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', marginBottom: 6 },
  list: { padding: 8, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.md,
    minHeight: 64,
  },
  rowUnread: { backgroundColor: colors.primaryPale },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15.5, fontWeight: '600', color: colors.text },
  titleUnread: { fontWeight: '800' },
  time: { fontSize: 12.5, fontWeight: '600', color: colors.textFaint },
  body: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  clear: { alignSelf: 'center', padding: 12, marginTop: 4 },
  clearText: { fontSize: 14.5, fontWeight: '700', color: colors.textFaint },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: 6 },
  emptyBody: { fontSize: 15, lineHeight: 22, color: colors.textMuted, textAlign: 'center', marginBottom: 8, paddingHorizontal: 8 },
});
