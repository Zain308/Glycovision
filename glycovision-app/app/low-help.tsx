// app/low-help.tsx
//
// Low sugar help: the "rule of 15" (American Diabetes Association
// guidance) in plain steps with local examples, a 15-minute countdown
// that also notifies when it ends, and one-tap calls to the user's
// emergency contact and Rescue 1122 (Pakistan).

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { cancelLowTimerAlert, startLowTimerAlert } from '@/lib/notifications';

const TIMER = 15 * 60;
const KEY_CONTACT = 'gv.emergencyContact.v1';
const EMERGENCY_NUMBER = '1122';

const STEPS = [
  { t: 'Take 15 g of fast sugar', d: '½ glass of juice or regular cola · 3 teaspoons of sugar in water · 1 tablespoon of honey · 4 glucose tablets' },
  { t: 'Wait 15 minutes', d: 'Sit down and rest. Start the timer below.' },
  { t: 'Check your sugar again', d: 'Still below 70 mg/dL? Take another 15 g and wait 15 minutes again.' },
  { t: 'Eat a small snack', d: 'Once above 70, have roti, biscuits or a fruit if your next meal is more than an hour away.' },
];

function Countdown() {
  const [left, setLeft] = useState(TIMER);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const [p, setP] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const remain = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setLeft(remain);
      if (remain === 0) {
        setRunning(false);
        haptic.warning();
      }
    }, 500);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    const listener = progress.addListener(({ value }) => setP(value));
    Animated.timing(progress, { toValue: 1 - left / TIMER, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    return () => progress.removeListener(listener);
  }, [left, progress]);

  const start = () => {
    haptic.tap();
    endAt.current = Date.now() + TIMER * 1000;
    setLeft(TIMER);
    setRunning(true);
    startLowTimerAlert(TIMER);
  };
  const reset = () => {
    setRunning(false);
    setLeft(TIMER);
    cancelLowTimerAlert();
  };

  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const done = left === 0;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={stroke} fill="none" />
          {p > 0.002 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={done ? colors.success : colors.danger}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${C * p} ${C}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
          ) : null}
        </Svg>
        <Text style={styles.timer} accessibilityLabel={`${Math.ceil(left / 60)} minutes left`}>
          {mm}:{ss}
        </Text>
        <Text style={styles.timerSub}>{done ? 'Check now' : running ? 'remaining' : '15 minutes'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 16 }}>
        {running ? (
          <Button label="Reset" icon="refresh" variant="secondary" onPress={reset} containerStyle={{ flex: 1 }} />
        ) : (
          <Button label={done ? 'Start again' : 'Start timer'} icon="timer-outline" onPress={start} containerStyle={{ flex: 1 }} />
        )}
        {done ? (
          <Button label="Log reading" icon="water" variant="secondary" onPress={() => router.push('/?logBg=1')} containerStyle={{ flex: 1 }} />
        ) : null}
      </View>
      <Text style={styles.timerNote}>You'll get a notification when the time is up, even if the app is closed.</Text>
    </View>
  );
}

export default function LowHelpScreen() {
  const [contact, setContact] = useState<{ name: string; phone: string }>({ name: '', phone: '' });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY_CONTACT)
      .then((raw) => {
        if (raw) setContact(JSON.parse(raw));
        else setEditing(true);
      })
      .catch(() => setEditing(true));
  }, []);

  const saveContact = async () => {
    haptic.success();
    await AsyncStorage.setItem(KEY_CONTACT, JSON.stringify(contact)).catch(() => {});
    setEditing(false);
  };

  const call = (number: string) => {
    haptic.tap();
    Linking.openURL(`tel:${number.replace(/[^0-9+]/g, '')}`).catch(() => {});
  };

  return (
    <Screen
      title="Low sugar help"
      subtitle="For readings below 70 mg/dL, or if you feel shaky, sweaty or confused."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      {/* Emergency first */}
      <Card style={styles.emergency}>
        <View style={styles.emHead}>
          <Ionicons name="warning" size={22} color={colors.dangerText} />
          <Text style={styles.emTitle}>Passed out or can't swallow?</Text>
        </View>
        <Text style={styles.emBody}>Don't give food or drink. Call for help now and use glucagon if your doctor prescribed it.</Text>
        <Button label={`Call Rescue ${EMERGENCY_NUMBER}`} icon="call" onPress={() => call(EMERGENCY_NUMBER)} style={styles.callBtn} />
      </Card>

      <SectionHeader title="The rule of 15" />
      <Card>
        {STEPS.map((s, i) => (
          <View key={s.t} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{s.t}</Text>
              <Text style={styles.stepBody}>{s.d}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionHeader title="15-minute timer" />
      <Card>
        <Countdown />
      </Card>

      <SectionHeader title="Emergency contact" action={!editing && contact.phone ? 'Edit' : undefined} onAction={() => setEditing(true)} />
      <Card>
        {editing ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={contact.name}
              onChangeText={(name) => setContact((c) => ({ ...c, name }))}
              placeholder="e.g. Ammi, Bhai, Dr. Ahmed"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Emergency contact name"
            />
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={contact.phone}
              onChangeText={(phone) => setContact((c) => ({ ...c, phone }))}
              placeholder="03xx xxxxxxx"
              placeholderTextColor={colors.textFaint}
              keyboardType="phone-pad"
              accessibilityLabel="Emergency contact phone number"
            />
            <Button label="Save contact" icon="checkmark" onPress={saveContact} disabled={!contact.phone.trim()} />
            <Text style={styles.small}>Saved only on this phone.</Text>
          </View>
        ) : (
          <View style={styles.contactRow}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{contact.name || 'Emergency contact'}</Text>
              <Text style={styles.stepBody}>{contact.phone}</Text>
            </View>
            <Button label="Call" icon="call" size="md" onPress={() => call(contact.phone)} />
          </View>
        )}
      </Card>

      <Text style={styles.footer}>Follow your own doctor's low-sugar plan if it differs from these steps.</Text>
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
  emergency: { backgroundColor: colors.dangerSoft, borderColor: '#F8D2D2' },
  emHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emTitle: { fontSize: 17, fontWeight: '800', color: colors.dangerText },
  emBody: { fontSize: 15, lineHeight: 22, color: colors.dangerText, marginTop: 6 },
  callBtn: { backgroundColor: colors.danger, marginTop: 14 },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontSize: 15, fontWeight: '800', color: colors.dangerText },
  stepTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  stepBody: { fontSize: 14.5, lineHeight: 21, color: colors.textMuted, marginTop: 2 },
  timer: { fontSize: 40, fontWeight: '800', color: colors.text, letterSpacing: -1, ...tabular },
  timerSub: { fontSize: 13.5, fontWeight: '600', color: colors.textMuted },
  timerNote: { fontSize: 13, color: colors.textFaint, textAlign: 'center', marginTop: 12, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  input: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    minHeight: 52,
    fontSize: 16.5,
    color: colors.text,
  },
  small: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { fontSize: 13, color: colors.textFaint, textAlign: 'center', marginTop: 18, lineHeight: 19 },
});
