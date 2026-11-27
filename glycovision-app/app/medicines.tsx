// app/medicines.tsx
//
// Medicines from the patient's own prescription: today's doses to tick off,
// reminders on the phone, and the list. GlycoVision never suggests a
// medicine, a dose or a change.

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { looksLikeInsulin, nextTime, shiftTime, showTime, STATE_TEXT } from '@/lib/medicines';
import { medicineRemindersOn, scheduleMedicines } from '@/lib/notifications';
import { addMedicine, getMedicines, logMedicine, removeMedicine, updateMedicine, type Medicine, type MedicineDose, type MedicineOverview } from '@/services/api';

function Editor({ medicine, onClose, onSaved }: { medicine: Medicine | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(medicine?.name ?? '');
  const [dose, setDose] = useState(medicine?.dose ?? '');
  const [note, setNote] = useState(medicine?.note ?? '');
  const [times, setTimes] = useState<string[]>(medicine?.times ?? ['08:00']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setError('Type the name of the medicine.');
    if (new Set(times).size !== times.length) return setError('Two of the times are the same.');
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), dose: dose.trim() || null, note: note.trim() || null, times };
    try {
      if (medicine) await updateMedicine(medicine.id, body);
      else await addMedicine(body);
      haptic.success();
      onSaved();
    } catch {
      setError('Could not save. Check your internet and try again.');
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{medicine ? 'Change medicine' : 'Add medicine'}</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="As on the box" placeholderTextColor={colors.textFaint} maxLength={80} accessibilityLabel="Medicine name" />
            {looksLikeInsulin(name) ? <Text style={styles.warn}>Mealtime insulin: log each dose in Bolus, so active insulin is counted. Here it is only a reminder.</Text> : null}
            <Text style={styles.label}>Dose on your prescription</Text>
            <TextInput style={styles.input} value={dose} onChangeText={setDose} placeholder="For example 1 tablet, 500 mg" placeholderTextColor={colors.textFaint} maxLength={60} accessibilityLabel="Dose" />
            <Text style={styles.label}>Times</Text>
            {times.map((t, i) => (
              <View key={i} style={styles.timeRow}>
                <Pressable onPress={() => setTimes(times.map((x, j) => (j === i ? shiftTime(x, -15) : x)))} accessibilityRole="button" accessibilityLabel="15 minutes earlier" style={styles.stepBtn}>
                  <Ionicons name="remove" size={20} color={colors.primary} />
                </Pressable>
                <Text style={styles.time}>{showTime(t)}</Text>
                <Pressable onPress={() => setTimes(times.map((x, j) => (j === i ? shiftTime(x, 15) : x)))} accessibilityRole="button" accessibilityLabel="15 minutes later" style={styles.stepBtn}>
                  <Ionicons name="add" size={20} color={colors.primary} />
                </Pressable>
                <Pressable onPress={() => setTimes(times.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove ${showTime(t)}`} style={styles.stepBtn}>
                  <Ionicons name="trash-outline" size={19} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
            {times.length < 6 ? <Button label="Add a time" icon="add" size="md" variant="ghost" onPress={() => setTimes([...times, nextTime(times)])} /> : null}
            {!times.length ? <Text style={styles.caption}>No times: only when needed, no reminder.</Text> : null}
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="For example after food" placeholderTextColor={colors.textFaint} maxLength={200} accessibilityLabel="Note" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Save" icon="checkmark" onPress={save} loading={busy} style={{ marginTop: 16 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const LOOK: Record<MedicineDose['state'], { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  taken: { icon: 'checkmark-circle', color: colors.success },
  skipped: { icon: 'remove-circle-outline', color: colors.textFaint },
  missed: { icon: 'help-circle-outline', color: colors.warning },
  due: { icon: 'alarm-outline', color: colors.primary },
  later: { icon: 'time-outline', color: colors.textFaint },
};

export default function MedicinesScreen() {
  const [data, setData] = useState<MedicineOverview | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null);
  const [remind, setRemind] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async (reschedule = false) => {
    try {
      const next = await getMedicines();
      setData(next);
      setError(false);
      const on = await medicineRemindersOn();
      setRemind(on);
      if (reschedule) setBlocked(!(await scheduleMedicines(next.medicines, on)));
    } catch (e) {
      console.log('Medicines unavailable:', e);
      setError(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const mark = async (d: MedicineDose, status: 'taken' | 'skipped' | null) => {
    if (!data) return;
    haptic.tap();
    const before = data;
    setData({ ...data, today: data.today.map((x) => (x === d ? { ...x, state: status ?? 'due' } : x)) });
    try {
      await logMedicine(d.medicine_id, data.day, d.time, status);
      load();
    } catch {
      setData(before);
      Alert.alert('Could not save', 'Check your internet and try again.');
    }
  };

  const askRemove = (m: Medicine) =>
    Alert.alert(`Remove ${m.name}?`, 'It leaves your list and its reminders stop. Don’t stop taking a medicine without asking your doctor.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          removeMedicine(m.id)
            .then(() => load(true))
            .catch(() => Alert.alert('Could not remove', 'Check your internet and try again.')),
      },
    ]);

  return (
    <Screen
      title="Medicines"
      subtitle="From your own prescription."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      {!data ? (
        <Card>
          {error ? (
            <>
              <Text style={styles.body}>Your medicines aren’t available right now. Check your internet and try again.</Text>
              <Button label="Try again" icon="refresh" size="md" variant="secondary" onPress={() => load()} style={{ marginTop: 12 }} />
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </Card>
      ) : (
        <>
          <SectionHeader title="Today" />
          <Card>
            {data.today.length ? (
              data.today.map((d, i) => {
                const done = d.state === 'taken' || d.state === 'skipped';
                return (
                  <View key={`${d.medicine_id}${d.time}`} style={[styles.dose, i > 0 && styles.line]}>
                    <Ionicons name={LOOK[d.state].icon} size={24} color={LOOK[d.state].color} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{d.name}</Text>
                      <Text style={styles.caption}>
                        {showTime(d.time)}
                        {d.dose ? ` · ${d.dose}` : ''} · {STATE_TEXT[d.state]}
                      </Text>
                    </View>
                    {done ? (
                      <Pressable onPress={() => mark(d, null)} accessibilityRole="button" accessibilityLabel={`Undo ${d.name}`} style={styles.smallBtn}>
                        <Text style={styles.link}>Undo</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Pressable onPress={() => mark(d, 'skipped')} accessibilityRole="button" accessibilityLabel={`${d.name} skipped`} style={styles.smallBtn}>
                          <Text style={[styles.link, { color: colors.textMuted }]}>Skip</Text>
                        </Pressable>
                        <Pressable onPress={() => mark(d, 'taken')} accessibilityRole="button" accessibilityLabel={`${d.name} taken`} style={styles.takeBtn}>
                          <Text style={styles.takeText}>Taken</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.body}>{data.medicines.length ? 'No medicines with a set time today.' : 'Add the medicines your doctor prescribed to get reminders and tick them off.'}</Text>
            )}
            {data.today.some((d) => d.state === 'missed') ? <Text style={[styles.caption, { marginTop: 10 }]}>Missed one? Follow your leaflet or ask your doctor. Don’t take a double dose.</Text> : null}
          </Card>

          {data.adherence.percent != null ? (
            <Card>
              <Text style={styles.name}>
                {data.adherence.taken} of {data.adherence.planned} doses taken
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${data.adherence.percent}%` as any }]} />
              </View>
              <Text style={styles.caption}>Last 7 full days, {data.adherence.percent}%</Text>
            </Card>
          ) : null}

          <SectionHeader title="My medicines" />
          <Card>
            {data.medicines.map((m, i) => (
              <View key={m.id} style={[styles.dose, i > 0 && styles.line]}>
                <Pressable onPress={() => setEditing(m)} accessibilityRole="button" accessibilityLabel={`Change ${m.name}`} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
                  <Text style={styles.name}>{m.name}</Text>
                  <Text style={styles.caption}>{[m.dose, m.times.length ? m.times.map(showTime).join(', ') : 'when needed', m.note].filter(Boolean).join(' · ')}</Text>
                </Pressable>
                <Pressable onPress={() => askRemove(m)} accessibilityRole="button" accessibilityLabel={`Remove ${m.name}`} style={styles.smallBtn}>
                  <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
            <Button label="Add medicine" icon="add-circle" size="md" onPress={() => setEditing('new')} style={data.medicines.length ? { marginTop: 12 } : undefined} />
          </Card>

          {data.medicines.length ? (
            <Card>
              <View style={styles.dose}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Reminders</Text>
                  <Text style={styles.caption}>{blocked ? 'Notifications are off for GlycoVision' : 'On this phone, at each time'}</Text>
                </View>
                <Switch
                  value={remind && !blocked}
                  onValueChange={async (on) => {
                    haptic.select();
                    if (on && blocked) {
                      Linking.openSettings();
                      return;
                    }
                    setRemind(on);
                    setBlocked(!(await scheduleMedicines(data.medicines, on)));
                  }}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                  accessibilityLabel="Medicine reminders"
                />
              </View>
            </Card>
          ) : null}
          <Text style={styles.foot}>GlycoVision only repeats what you typed in. It never suggests a medicine or a dose.</Text>
        </>
      )}

      {editing ? (
        <Editor
          medicine={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(true);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  caption: { fontSize: 13.5, lineHeight: 19, color: colors.textFaint },
  dose: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 },
  line: { borderTopWidth: 1, borderTopColor: colors.divider },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  smallBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  link: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  takeBtn: { minHeight: 44, paddingHorizontal: 15, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  takeText: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
  track: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginVertical: 8 },
  fill: { height: 12, borderRadius: 6, backgroundColor: colors.primary },
  foot: { fontSize: 13.5, lineHeight: 19, color: colors.textFaint, textAlign: 'center', marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,27,45,0.45)' },
  sheet: { maxHeight: '88%', backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 22, paddingTop: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 21, fontWeight: '800', color: colors.text },
  label: { fontSize: 14, fontWeight: '700', color: colors.textMuted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.input, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 54, fontSize: 17, color: colors.text },
  warn: { fontSize: 14, lineHeight: 20, color: colors.warningText, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: 12, marginTop: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  time: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.text, ...tabular },
  stepBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 14.5, fontWeight: '700', color: colors.dangerText, marginTop: 12 },
});
