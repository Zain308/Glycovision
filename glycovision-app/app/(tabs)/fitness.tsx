// app/(tabs)/fitness.tsx
// Fitness tab: loads /fitness, keeps it fresh, and opens the small sheets.

import React, { useCallback, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { FitnessView } from '@/components/fitness/FitnessView';
import { NumberSheet, type NumberField } from '@/components/fitness/NumberSheet';
import { colors } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { setBackground } from '@/lib/backgroundSync';
import { syncNow, trackingOn } from '@/lib/healthConnect';
import { startRecorder } from '@/lib/stepRecorder';
import { addVital, deleteActivity, getFitness, updateProfile, type Fitness, type VitalKind } from '@/services/api';

const VITALS: Record<VitalKind, { title: string; note?: string; fields: NumberField[] }> = {
  weight: { title: 'Weight', note: 'Also updates your BMI and calories.', fields: [{ label: 'Weight', unit: 'kg', min: 15, max: 350, placeholder: '70' }] },
  blood_pressure: {
    title: 'Blood pressure',
    note: 'Sit and rest for 5 minutes before measuring.',
    fields: [
      { label: 'Upper number (systolic)', unit: 'mmHg', min: 50, max: 300, placeholder: '120' },
      { label: 'Lower number (diastolic)', unit: 'mmHg', min: 30, max: 200, placeholder: '80' },
    ],
  },
  hba1c: { title: 'HbA1c', note: 'From your lab report.', fields: [{ label: 'HbA1c', unit: '%', min: 3, max: 20, placeholder: '7.0' }] },
  sleep: { title: 'Sleep last night', fields: [{ label: 'Hours slept', unit: 'hours', min: 0.5, max: 24, placeholder: '7.5' }] },
};

export default function FitnessScreen() {
  const [data, setData] = useState<Fitness | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tracking, setTracking] = useState(true);
  const [sheet, setSheet] = useState<VitalKind | 'goals' | null>(null);

  const load = useCallback(async () => {
    const fetchNow = async () => {
      try {
        setData(await getFitness());
        setError(false);
      } catch (e) {
        console.log('Fitness unavailable:', e);
        setError(true);
      }
    };
    setTracking(await trackingOn());
    await fetchNow();
    setRefreshing(false);
    // Then bring in anything new from the phone or watch.
    if ((await syncNow()) > 0) await fetchNow();
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // One tap: permission, start the phone's counter, keep it updated.
  const countSteps = async () => {
    haptic.tap();
    const result = await startRecorder();
    if (result === 'on') {
      await setBackground(true);
      haptic.success();
      Alert.alert('Counting your steps', 'Your phone now counts all day, even when GlycoVision is closed.');
      load();
    } else if (result === 'denied') {
      Alert.alert('Permission needed', 'Allow “Physical activity” for GlycoVision so your phone can count steps.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
    } else {
      // Not on this phone (or Expo Go): show the other ways.
      router.push('/activity' as any);
    }
  };

  const saveVital = async (kind: VitalKind, values: number[]) => {
    if (kind === 'blood_pressure' && values[1] >= values[0]) throw new Error('!The lower number must be below the upper one.');
    await addVital(kind, values[0], values[1]);
    haptic.success();
    setSheet(null);
    load();
  };

  const askDelete = (id: number, name: string) =>
    Alert.alert('Delete this activity?', name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteActivity(id)
            .then(load)
            .catch(() => Alert.alert('Could not delete', 'Check your internet and try again.')),
      },
    ]);

  return (
    <Screen
      title="Fitness"
      subtitle="Your movement, sleep and body, all day."
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
    >
      {data ? (
        <FitnessView
          data={data}
          connected={tracking}
          onConnect={countSteps}
          onWorkout={() => router.push('/workout' as any)}
          onAdd={() => router.push('/activity' as any)}
          onGoals={() => setSheet('goals')}
          onVital={setSheet}
          onDelete={askDelete}
          onVoice={() => router.push('/(tabs)/voice')}
        />
      ) : error ? (
        <Card>
          <Text style={styles.body}>Your activity isn’t available right now. Check your internet and try again.</Text>
          <Button label="Try again" icon="refresh" size="md" variant="secondary" onPress={load} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <View style={{ gap: 14 }}>
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={320} />
        </View>
      )}

      {sheet && sheet !== 'goals' ? (
        <NumberSheet key={sheet} {...VITALS[sheet]} onClose={() => setSheet(null)} onSave={(v) => saveVital(sheet, v)} />
      ) : null}
      {sheet === 'goals' && data ? (
        <NumberSheet
          title="Your goals"
          note="150 Heart Points a week is the advice for most adults. Ask your doctor before a big change."
          fields={[
            { label: 'Steps a day', unit: 'steps', min: 1000, max: 40000, placeholder: '8000', initial: String(data.goals.steps) },
            { label: 'Heart Points a week', unit: 'points', min: 30, max: 600, placeholder: '150', initial: String(data.goals.heart_pts) },
          ]}
          onClose={() => setSheet(null)}
          onSave={async ([steps, points]) => {
            await updateProfile({ step_goal: Math.round(steps), heart_goal: Math.round(points) });
            haptic.success();
            setSheet(null);
            load();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
});
