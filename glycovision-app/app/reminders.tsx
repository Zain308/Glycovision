// app/reminders.tsx
//
// Reminders & alerts: smart health alerts (on/off, with what each does),
// daily reminders with a time each, a test notification, and a clear way
// to fix blocked permissions. Everything is scheduled on the phone.

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { IconBadge, SectionHeader, StatusPill } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import {
  REMINDER_INFO,
  loadReminders,
  permissionStatus,
  saveReminders,
  sendTestNotification,
  setSmartAlerts,
  smartAlertsEnabled,
  type ReminderKey,
  type Reminders,
} from '@/lib/notifications';

const ICONS: Record<ReminderKey, React.ComponentProps<typeof Ionicons>['name']> = {
  fasting: 'sunny',
  bedtime: 'moon',
  insulin_morning: 'medkit',
  insulin_evening: 'medkit',
};

const fmtTime = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function TimeStepper({ hour, minute, onChange }: { hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  const shift = (delta: number) => {
    haptic.select();
    const total = (hour * 60 + minute + delta + 24 * 60) % (24 * 60);
    onChange(Math.floor(total / 60), total % 60);
  };
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => shift(-15)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="15 minutes earlier" hitSlop={6}>
        <Ionicons name="remove" size={20} color={colors.primary} />
      </Pressable>
      <Text style={styles.time}>{fmtTime(hour, minute)}</Text>
      <Pressable onPress={() => shift(15)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="15 minutes later" hitSlop={6}>
        <Ionicons name="add" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

export default function RemindersScreen() {
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [smart, setSmart] = useState(true);
  const [perm, setPerm] = useState<string>('undetermined');
  const [testSent, setTestSent] = useState<null | 'sent' | 'blocked'>(null);

  const refreshPerm = useCallback(() => {
    permissionStatus().then(setPerm);
  }, []);

  useEffect(() => {
    loadReminders().then(setReminders);
    smartAlertsEnabled().then(setSmart);
  }, []);
  useFocusEffect(refreshPerm);

  const update = async (next: Reminders) => {
    setReminders(next);
    await saveReminders(next);
    refreshPerm();
  };

  const supported = Platform.OS === 'ios' || Platform.OS === 'android';

  return (
    <Screen
      title="Reminders & alerts"
      subtitle="GlycoVision reminds you to check and warns you when something needs attention."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      {!supported ? (
        <Card variant="tint">
          <Text style={styles.body}>Notifications work in the phone app (Android and iPhone), not in the browser.</Text>
        </Card>
      ) : perm === 'denied' ? (
        <Card style={styles.blocked}>
          <IconBadge icon="notifications-off" tone="danger" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Notifications are blocked</Text>
            <Text style={styles.body}>Turn them on in your phone settings so alerts and reminders can reach you.</Text>
            <Button label="Open settings" icon="settings-outline" size="md" variant="secondary" onPress={() => Linking.openSettings()} style={{ marginTop: 10 }} />
          </View>
        </Card>
      ) : null}

      {/* SMART ALERTS */}
      <SectionHeader title="Smart health alerts" />
      <Card>
        <View style={styles.rowTop}>
          <IconBadge icon="pulse" tone="danger" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Alerts from your readings</Text>
            <Text style={styles.caption}>Automatic, based on what you log</Text>
          </View>
          <Switch
            value={smart}
            onValueChange={(v) => {
              haptic.select();
              setSmart(v);
              setSmartAlerts(v);
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
            accessibilityLabel="Smart health alerts"
          />
        </View>
        {[
          { icon: 'arrow-down-circle' as const, tone: 'danger' as const, t: 'Low sugar (below 70)', d: 'Alert right away, then a recheck reminder after 15 minutes' },
          { icon: 'arrow-up-circle' as const, tone: 'warning' as const, t: 'Very high sugar (above 250)', d: 'Recheck reminder after 2 hours' },
          { icon: 'restaurant' as const, tone: 'warning' as const, t: 'After a meal', d: 'Check your sugar 2 hours after a logged meal' },
          { icon: 'trending-up' as const, tone: 'brand' as const, t: 'Rise risk', d: 'When a rise in the next hour looks likely (max every 2 h)' },
        ].map((r) => (
          <View key={r.t} style={[styles.alertRow, !smart && { opacity: 0.45 }]}>
            <Ionicons name={r.icon} size={20} color={colors[r.tone === 'brand' ? 'primary' : r.tone]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>{r.t}</Text>
              <Text style={styles.caption}>{r.d}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* DAILY REMINDERS */}
      <SectionHeader title="Daily reminders" />
      <Card>
        {reminders &&
          (Object.keys(REMINDER_INFO) as ReminderKey[]).map((key, i) => {
            const r = reminders[key];
            return (
              <View key={key}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.rowTop}>
                  <IconBadge icon={ICONS[key]} tone={key.startsWith('insulin') ? 'brand' : key === 'bedtime' ? 'info' : 'warning'} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reminderTitle}>{REMINDER_INFO[key].label}</Text>
                    <Text style={styles.caption}>{r.enabled ? `Every day at ${fmtTime(r.hour, r.minute)}` : 'Off'}</Text>
                  </View>
                  <Switch
                    value={r.enabled}
                    onValueChange={(v) => {
                      haptic.select();
                      update({ ...reminders, [key]: { ...r, enabled: v } });
                    }}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    thumbColor="#fff"
                    accessibilityLabel={REMINDER_INFO[key].label}
                  />
                </View>
                {r.enabled ? (
                  <TimeStepper
                    hour={r.hour}
                    minute={r.minute}
                    onChange={(h, m) => update({ ...reminders, [key]: { ...r, hour: h, minute: m } })}
                  />
                ) : null}
              </View>
            );
          })}
      </Card>

      {supported ? (
        <View style={{ gap: 10 }}>
          <Button
            label="Send a test notification"
            icon="notifications-outline"
            variant="secondary"
            onPress={async () => setTestSent((await sendTestNotification()) ? 'sent' : 'blocked')}
          />
          {testSent ? (
            <StatusPill
              tone={testSent === 'sent' ? 'success' : 'danger'}
              icon={testSent === 'sent' ? 'checkmark-circle' : 'alert-circle'}
              label={testSent === 'sent' ? 'Arriving in a few seconds' : 'Notifications are blocked'}
              style={{ alignSelf: 'center' }}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.footer}>
        Reminders support your routine but don't replace your doctor's plan. Keep your phone's sound on for alerts.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blocked: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderColor: colors.dangerSoft },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  cardTitle: { fontSize: 16.5, fontWeight: '800', color: colors.text },
  reminderTitle: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  caption: { fontSize: 13.5, color: colors.textMuted, marginTop: 2, lineHeight: 19 },
  body: { fontSize: 14.5, lineHeight: 21, color: colors.textMuted, marginTop: 4 },
  alertRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingTop: 14 },
  alertTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 6 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 6,
    marginLeft: 52,
    marginBottom: 8,
  },
  stepBtn: {
    width: 44,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontSize: 18, fontWeight: '800', color: colors.text, ...tabular },
  footer: { fontSize: 13, color: colors.textFaint, textAlign: 'center', marginTop: 18, lineHeight: 19 },
});
