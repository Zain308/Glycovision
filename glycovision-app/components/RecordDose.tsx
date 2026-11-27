// components/RecordDose.tsx
// Write down insulin already taken. Nothing is calculated, so it works without
// internet; the dose counts as active insulin once it is uploaded.

import React, { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { logBolus, type TimelineEvent } from '@/services/api';

const MAX_UNITS = 50;

/** Units, or the reason they can't be saved. */
export function parseUnits(text: string): number | string {
  const v = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(v) || v <= 0) return 'Type the units you took.';
  if (v > MAX_UNITS) return `More than ${MAX_UNITS} units can’t be saved. Check the number.`;
  return Math.round(v * 100) / 100;
}

export function RecordDose({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const save = async (units: number) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await logBolus({ dose_units: units });
      haptic.success();
      setText('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this dose.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const ask = () => {
    const units = parseUnits(text);
    if (typeof units === 'string') return setError(units);
    setError(null);
    Alert.alert(`Save ${units} units?`, 'Mealtime insulin you have just taken.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: () => save(units) },
    ]);
  };

  return (
    <>
      <SectionHeader title="Insulin I took" style={{ marginTop: 22 }} />
      <Card>
        <Text style={styles.text}>Only to record a dose you have just taken, such as one your doctor told you to take.</Text>
        <View style={styles.row}>
          <View style={styles.box}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(t) => {
                setText(t);
                setError(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textFaint}
              maxLength={5}
              accessibilityLabel="Units of insulin you took"
            />
            <Text style={styles.unit}>units</Text>
          </View>
          <Button label="Save dose" size="md" variant="secondary" onPress={ask} loading={saving} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

export function InsulinToday({ events }: { events: TimelineEvent[] }) {
  const doses = events.filter((e) => e.type === 'insulin');
  if (!doses.length) return null;
  return (
    <>
      <SectionHeader title="Insulin logged today" style={{ marginTop: 22 }} />
      <Card>
        {doses.map((e) => (
          <View key={e.logged_at} style={styles.dose}>
            <Text style={styles.doseText}>{e.title}</Text>
            <Text style={styles.text}>{new Date(e.logged_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14.5, lineHeight: 20, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  box: { flex: 1, minWidth: 130, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 54 },
  input: { flex: 1, minWidth: 0, fontSize: 22, fontWeight: '800', color: colors.text, ...tabular },
  unit: { fontSize: 15, color: colors.textMuted },
  error: { fontSize: 14.5, color: colors.dangerText, marginTop: 10 },
  dose: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  doseText: { fontSize: 16, fontWeight: '700', color: colors.text },
});
