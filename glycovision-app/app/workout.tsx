// app/workout.tsx
//
// Live workout: first a safety check from the care plan (sugar, active
// insulin), then a timer with steps, pace, distance and calories.
//
// The phone's step sensor stops when the screen is off, so the time is taken
// from the clock, and when Health Connect is on its step count for the whole
// workout is used if it is higher.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { Pedometer } from 'expo-sensors';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { colors, radius, tabular } from '@/constants/theme';
import { clockTime, distanceFromSteps, pace, workoutKcal, WORKOUTS } from '@/lib/fitness';
import { haptic } from '@/lib/haptics';
import { stepsBetween } from '@/lib/healthConnect';
import { getCarePlan, getProfile, logActivity, type ActivityPlan } from '@/services/api';

type Phase = 'choose' | 'running' | 'paused';

export default function WorkoutScreen() {
  const [phase, setPhase] = useState<Phase>('choose');
  const [kind, setKind] = useState<(typeof WORKOUTS)[number]>(WORKOUTS[0]);
  const [safety, setSafety] = useState<ActivityPlan | null>(null);
  const [safetyFailed, setSafetyFailed] = useState(false);
  const [body, setBody] = useState<{ weight?: number | null; height?: number | null }>({});
  const [seconds, setSeconds] = useState(0);
  const [steps, setSteps] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Clock: time before the last pause, plus time since the last start.
  const done = useRef(0);
  const startedAt = useRef(0);
  const firstStart = useRef(0);
  const stepBase = useRef(0);
  const sub = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    getCarePlan()
      .then((p) => setSafety(p.activity))
      .catch(() => setSafetyFailed(true));
    getProfile()
      .then((p: any) => setBody({ weight: p.weight_kg, height: p.height_cm }))
      .catch(() => {});
    return () => {
      sub.current?.remove();
      deactivateKeepAwake('workout').catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setSeconds(done.current + (Date.now() - startedAt.current) / 1000), 500);
    return () => clearInterval(id);
  }, [phase]);

  const countSteps = async () => {
    if (!kind.steps || Platform.OS === 'web') return;
    try {
      const p = await Pedometer.requestPermissionsAsync();
      if (!p.granted || !(await Pedometer.isAvailableAsync())) return;
      sub.current?.remove();
      const base = stepBase.current;
      setSteps(base);
      sub.current = Pedometer.watchStepCount((r) => {
        stepBase.current = base + r.steps;
        setSteps(base + r.steps);
      });
    } catch (e) {
      console.log('[workout] no step counter', e); // Expo Go on Android has none
    }
  };

  const start = () => {
    haptic.success();
    const now = Date.now();
    if (!firstStart.current) firstStart.current = now;
    startedAt.current = now;
    setPhase('running');
    activateKeepAwakeAsync('workout').catch(() => {});
    countSteps();
  };

  const pause = () => {
    haptic.tap();
    done.current += (Date.now() - startedAt.current) / 1000;
    setSeconds(done.current);
    sub.current?.remove();
    sub.current = null;
    deactivateKeepAwake('workout').catch(() => {});
    setPhase('paused');
  };

  const finish = async () => {
    const total = phase === 'running' ? done.current + (Date.now() - startedAt.current) / 1000 : done.current;
    if (phase === 'running') pause();
    const minutes = Math.round(total / 60);
    if (minutes < 1) {
      Alert.alert('Too short to save', 'Move for at least one minute.', [
        { text: 'Keep going', onPress: start },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    setSaving(true);
    try {
      const recorded = kind.steps ? await stepsBetween(firstStart.current, Date.now()) : null;
      const counted = kind.steps ? Math.max(stepBase.current, recorded ?? 0) : 0;
      await logActivity(kind.name, Math.min(600, minutes), {
        steps: counted || undefined,
        distance_m: counted ? distanceFromSteps(counted, body.height) : undefined,
        kcal: workoutKcal(kind.met, body.weight, total) ?? undefined,
      });
      haptic.success();
      router.back();
    } catch {
      Alert.alert('Could not save', 'Check your internet and try again. Your workout is still here.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (phase === 'choose') return router.back();
    Alert.alert('Stop this workout?', 'It will not be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const blocked = safety?.status === 'blocked';
  const speed = steps != null ? pace(steps, seconds) : null;
  const kcal = workoutKcal(kind.met, body.weight, seconds);
  const distance = steps ? distanceFromSteps(steps, body.height) : null;

  return (
    <Screen
      title={phase === 'choose' ? 'Start a workout' : kind.name}
      right={
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      {phase === 'choose' ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>Is it safe right now?</Text>
            {safety ? (
              <>
                <Text style={[styles.body, blocked && { color: colors.dangerText, fontWeight: '700' }]}>
                  {safety.headline}. {safety.why}
                </Text>
                {safety.safety.map((s) => (
                  <View key={s} style={styles.safetyRow}>
                    <Ionicons name="shield-checkmark-outline" size={17} color={colors.textMuted} />
                    <Text style={styles.safetyText}>{s}</Text>
                  </View>
                ))}
              </>
            ) : safetyFailed ? (
              <Text style={styles.body}>The safety check isn’t available. Check your sugar first, and don’t exercise below 70 or above 300.</Text>
            ) : (
              <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
            )}
          </Card>
          <View style={styles.grid}>
            {WORKOUTS.map((w) => {
              const on = w.name === kind.name;
              return (
                <Pressable
                  key={w.name}
                  onPress={() => {
                    haptic.select();
                    setKind(w);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.kind, on && styles.kindOn]}
                >
                  <Ionicons name={w.icon as any} size={24} color={on ? '#fff' : colors.primary} />
                  <Text style={[styles.kindText, on && { color: '#fff' }]} numberOfLines={1} adjustsFontSizeToFit>
                    {w.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button label={blocked ? 'Not now: treat your sugar first' : `Start ${kind.name.toLowerCase()}`} icon="play" onPress={start} disabled={blocked || (!safety && !safetyFailed)} />
          {blocked && /low/i.test(safety?.headline ?? '') ? <Button label="Low sugar help" icon="medkit-outline" variant="secondary" size="md" onPress={() => router.push('/low-help')} style={{ marginTop: 10 }} /> : null}
        </>
      ) : (
        <>
          <Card style={{ alignItems: 'center', paddingVertical: 26 }}>
            <Text style={styles.time} accessibilityLabel={`Time ${clockTime(seconds)}`}>
              {clockTime(seconds)}
            </Text>
            <Text style={styles.caption}>{phase === 'paused' ? 'Paused' : speed ? `${speed.label}${speed.perMinute ? ` · ${speed.perMinute} steps a minute` : ''}` : 'Keep going'}</Text>
            <View style={styles.row}>
              {kind.steps ? (
                <View style={styles.cell}>
                  <Text style={styles.value}>{steps != null ? steps.toLocaleString() : '–'}</Text>
                  <Text style={styles.caption}>steps</Text>
                </View>
              ) : null}
              {kind.steps ? (
                <View style={styles.cell}>
                  <Text style={styles.value}>{distance != null ? (distance / 1000).toFixed(2) : '–'}</Text>
                  <Text style={styles.caption}>km (est.)</Text>
                </View>
              ) : null}
              <View style={styles.cell}>
                <Text style={styles.value}>{kcal ?? '–'}</Text>
                <Text style={styles.caption}>kcal (est.)</Text>
              </View>
            </View>
          </Card>
          <View style={styles.buttons}>
            {phase === 'running' ? (
              <Button label="Pause" icon="pause" variant="secondary" onPress={pause} containerStyle={{ flex: 1 }} />
            ) : (
              <Button label="Resume" icon="play" variant="secondary" onPress={start} containerStyle={{ flex: 1 }} />
            )}
            <Button label="Finish" icon="checkmark" onPress={finish} loading={saving} containerStyle={{ flex: 1 }} />
          </View>
          <Card style={{ marginTop: 14 }}>
            <Text style={styles.body}>Stop and check your sugar if you feel shaky, sweaty, dizzy or weak.</Text>
            <Button label="I feel low" icon="warning-outline" variant="secondary" size="md" onPress={() => router.push('/low-help')} style={{ marginTop: 12 }} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16.5, fontWeight: '800', color: colors.text, marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  caption: { fontSize: 14, color: colors.textMuted },
  safetyRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  safetyText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kind: { width: '31%', flexGrow: 1, minHeight: 84, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4 },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  time: { fontSize: 60, fontWeight: '800', color: colors.text, letterSpacing: -1.5, ...tabular },
  row: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 22 },
  cell: { flex: 1, alignItems: 'center' },
  value: { fontSize: 24, fontWeight: '800', color: colors.text, ...tabular },
  buttons: { flexDirection: 'row', gap: 10 },
});
