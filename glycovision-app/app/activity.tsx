// app/activity.tsx
//
// Activity settings: connect automatic data (Health Connect) and background
// updates, move reminders, add activity by hand, automatic voice checks.

import React, { useCallback, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { AudioModule } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { IconBadge, SectionHeader } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { autoVoiceOn, setAutoVoice } from '@/lib/autoVoice';
import { haptic } from '@/lib/haptics';
import { recorderAvailable, recorderOn, startRecorder, stopRecorder } from '@/lib/stepRecorder';
import { backgroundOn, moveRemindersOn, setBackground, setMoveReminders } from '@/lib/backgroundSync';
import { allowBackground, connectHealth, disconnectHealth, healthAccess, healthStatus, openHealthSettings, syncNow, type HealthStatus } from '@/lib/healthConnect';
import { ensurePermission } from '@/lib/notifications';
import { getActivityToday, getStressGauge, logActivity, type ActivityToday, type StressGauge } from '@/services/api';

const ACTIVITIES = ['Walking', 'Stretching', 'Cycling', 'Running', 'Housework', 'Yoga', 'Strength', 'Cricket', 'Football', 'Badminton', 'Swimming'];
const MINUTES = [5, 10, 15, 30, 45, 60];
const HC_STORE = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

export default function ActivityScreen() {
  const [status, setStatus] = useState<HealthStatus>('off');
  const [today, setToday] = useState<ActivityToday | null>(null);
  const [gauge, setGauge] = useState<StressGauge | null>(null);
  const [auto, setAuto] = useState(false);
  const [background, setBackgroundState] = useState(false);
  const [move, setMove] = useState(false);
  const [steps, setSteps] = useState(false);
  const [missing, setMissing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('Walking');
  const [minutes, setMinutes] = useState(15);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await healthStatus());
    setAuto(await autoVoiceOn());
    setSteps(await recorderOn());
    setMissing((await healthAccess()).missing);
    setBackgroundState(await backgroundOn());
    setMove(await moveRemindersOn());
    getActivityToday().then(setToday).catch(() => {});
    getStressGauge().then(setGauge).catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const allowed = await connectHealth();
      if (!allowed.length) {
        setMessage({ ok: false, text: 'No permission was given. You can allow it in Health Connect, or add activity by hand below.' });
      } else {
        const n = await syncNow(true);
        setMessage({
          ok: true,
          text: n > 0 ? 'Connected. Your recent data was added.' : 'Connected. No data yet. New phones count steps by themselves from now on; on others, turn on sharing with Health Connect in Google Fit, Samsung Health or your watch app.',
        });
      }
    } catch {
      setMessage({ ok: false, text: 'Could not connect. Please try again.' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const toggleSteps = async (on: boolean) => {
    haptic.select();
    if (!on) {
      await stopRecorder();
      setSteps(false);
      return;
    }
    const result = await startRecorder();
    setSteps(result === 'on');
    if (result === 'on') {
      setBackgroundState(await setBackground(true));
      syncNow(true).then(refresh);
    } else if (result === 'denied') {
      Alert.alert('Permission needed', 'Allow “Physical activity” for GlycoVision so your phone can count steps.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
    } else {
      setMessage({ ok: false, text: 'The step counter could not start. Update Google Play services in the Play Store and try again.' });
    }
  };

  const toggleBackground = async (on: boolean) => {
    haptic.select();
    // Health Connect needs its own permission; our step counter doesn't.
    if (on && status === 'on' && !(await allowBackground()) && !steps) {
      Alert.alert('Not allowed yet', 'Allow “background access” for GlycoVision in Health Connect. Some phones don’t support it; your data then updates when you open the app.', [
        { text: 'OK', style: 'cancel' },
        { text: 'Open Health Connect', onPress: openHealthSettings },
      ]);
      return;
    }
    setBackgroundState((await setBackground(on)) && on);
    if (!on) {
      await setMoveReminders(false);
      setMove(false);
    }
  };

  const toggleMove = async (on: boolean) => {
    haptic.select();
    if (on && !(await ensurePermission())) {
      Alert.alert('Notifications are off', 'Turn on notifications for GlycoVision to get move reminders.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    await setMoveReminders(on);
    setMove(on);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await logActivity(activity, minutes);
      haptic.success();
      setMessage({ ok: true, text: `${activity}, ${minutes} minutes added.` });
      getActivityToday().then(setToday).catch(() => {});
    } catch {
      setMessage({ ok: false, text: 'Could not save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    const p = await AudioModule.requestRecordingPermissionsAsync();
    if (!p.granted) {
      Alert.alert('Microphone needed', 'Allow the microphone so voice checks can run.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    await setAutoVoice(true);
    setAuto(true);
  };

  const toggleVoice = (on: boolean) => {
    haptic.select();
    if (!on) {
      setAutoVoice(false);
      setAuto(false);
      return;
    }
    Alert.alert(
      'Turn on automatic voice checks?',
      'While GlycoVision is open, it records 8 seconds every 15 minutes and shows a “Listening” label. It may pick up people near you, so turn it off in private conversations. Recordings are deleted after analysis. Do 5 voice checks yourself first, so it learns your voice.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: turnOn },
      ],
    );
  };

  const stats = [
    { label: 'steps', value: today?.steps != null ? today.steps.toLocaleString() : '–' },
    { label: 'active kcal', value: today?.active_kcal != null ? `${today.active_kcal}` : '–' },
    { label: 'heart rate', value: today?.heart_rate != null ? `${today.heart_rate}` : '–' },
    { label: 'added by hand', value: `${today?.manual_minutes ?? 0} min` },
  ];

  return (
    <Screen
      title="Activity & stress"
      subtitle="Automatic when you connect your phone or watch, or added by hand."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      <Card>
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {s.value}
              </Text>
              <Text style={styles.caption}>{s.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {message ? (
        <View style={[styles.message, { backgroundColor: message.ok ? colors.successSoft : colors.dangerSoft }]} accessibilityLiveRegion="polite">
          <Text style={[styles.messageText, { color: message.ok ? colors.successText : colors.dangerText }]}>{message.text}</Text>
        </View>
      ) : null}

      <SectionHeader title="Automatic" />
      <Card>
        <View style={styles.head}>
          <IconBadge icon="footsteps-outline" tone="brand" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Count my steps all day</Text>
            <Text style={styles.caption}>Your phone counts even when GlycoVision is closed. No Google Fit or account needed.</Text>
          </View>
          <Switch value={steps} onValueChange={toggleSteps} disabled={!recorderAvailable()} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel="Count my steps all day" />
        </View>
        {!recorderAvailable() ? <Text style={styles.caption}>{Platform.OS === 'android' ? 'Not available here. It needs the installed GlycoVision app (not Expo Go) and up-to-date Google Play services.' : 'Available in the Android app.'}</Text> : null}
        {steps || status === 'on' ? (
          <>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Update in the background</Text>
            <Text style={styles.caption}>About every 15 to 30 minutes, even when the app is closed</Text>
          </View>
          <Switch value={background} onValueChange={toggleBackground} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel="Update in the background" />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Move reminders</Text>
            <Text style={styles.caption}>{background ? 'After an hour of sitting, 8 AM to 10 PM' : 'Turn on background updates first'}</Text>
          </View>
          <Switch value={move} onValueChange={toggleMove} disabled={!background} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel="Move reminders" />
        </View>
          </>
        ) : null}
      </Card>
      <Card>
        <View style={styles.head}>
          <IconBadge icon="link-outline" tone="brand" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Meter, watch, sleep and more (Health Connect)</Text>
            <Text style={styles.caption}>Blood sugar from your meter or sensor, heart rate, sleep, workouts, weight and blood pressure, from any app that shares with Health Connect</Text>
          </View>
        </View>
        {status === 'unsupported' ? (
          <Text style={styles.body}>
            {Platform.OS === 'android' ? 'This phone does not support Health Connect. Add your activity by hand below.' : 'Automatic data works in the Android app. Add your activity by hand below.'}
          </Text>
        ) : status === 'needs_install' ? (
          <Button label="Install Health Connect" icon="download-outline" size="md" onPress={() => Linking.openURL(HC_STORE)} style={{ marginTop: 12 }} />
        ) : status === 'on' ? (
          <>
            <Text style={styles.body}>Connected. New data is added each time you open GlycoVision.</Text>
            {missing ? <Button label={`Allow ${missing} more kinds of data`} icon="add-circle-outline" size="md" variant="secondary" onPress={connect} loading={busy} style={{ marginTop: 12 }} /> : null}
            <View style={styles.buttons}>
              <Button label="Manage" size="md" variant="secondary" onPress={openHealthSettings} containerStyle={{ flex: 1 }} />
              <Button label="Disconnect" size="md" variant="ghost" onPress={() => Promise.all([disconnectHealth(), ...(steps ? [] : [setBackground(false), setMoveReminders(false)])]).then(refresh)} containerStyle={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <Button label="Connect" icon="link-outline" size="md" onPress={connect} loading={busy} style={{ marginTop: 12 }} />
        )}
      </Card>

      <SectionHeader title="Add by hand" />
      <Card>
        <View style={styles.chips}>
          {ACTIVITIES.map((a) => (
            <Pressable key={a} onPress={() => setActivity(a)} accessibilityRole="radio" accessibilityState={{ selected: a === activity }} style={[styles.chip, a === activity && styles.chipOn]}>
              <Text style={[styles.chipText, a === activity && { color: '#fff' }]}>{a}</Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.chips, { marginTop: 12 }]}>
          {MINUTES.map((m) => (
            <Pressable key={m} onPress={() => setMinutes(m)} accessibilityRole="radio" accessibilityState={{ selected: m === minutes }} style={[styles.chip, m === minutes && styles.chipOn]}>
              <Text style={[styles.chipText, m === minutes && { color: '#fff' }]}>{m} min</Text>
            </Pressable>
          ))}
        </View>
        <Button label={`Add ${activity.toLowerCase()}, ${minutes} min`} icon="add-circle" size="md" onPress={save} loading={busy} style={{ marginTop: 14 }} />
      </Card>

      <SectionHeader title="Stress" />
      <Card>
        {gauge?.level ? (
          <Text style={styles.body}>
            Right now: <Text style={{ fontWeight: '800', color: colors.text }}>{gauge.level === 'calm' ? 'calm' : gauge.level === 'possible' ? 'possible stress' : 'stress likely'}</Text>, from {gauge.basis}.
          </Text>
        ) : (
          <Text style={styles.body}>No stress estimate yet. Do a voice check, or connect a watch that records heart rate.</Text>
        )}
        {gauge ? <Text style={styles.caption}>{gauge.heart_reason}</Text> : null}
        <View style={[styles.head, { marginTop: 16, marginBottom: 0 }]}>
          <IconBadge icon="mic-outline" tone="brand" />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Automatic voice checks</Text>
            <Text style={styles.caption}>While the app is open, every 15 minutes</Text>
          </View>
          <Switch value={auto} onValueChange={toggleVoice} disabled={Platform.OS === 'web'} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel="Automatic voice checks" />
        </View>
        <Text style={[styles.caption, { marginTop: 12 }]}>Stress changes your advice, never your insulin dose.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text, ...tabular },
  caption: { fontSize: 13.5, lineHeight: 19, color: colors.textFaint },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  cardTitle: { fontSize: 16.5, fontWeight: '800', color: colors.text },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, minHeight: 48 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  message: { borderRadius: radius.md, padding: 14, marginBottom: 14 },
  messageText: { fontSize: 14.5, lineHeight: 20, fontWeight: '700' },
});
