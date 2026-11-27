// components/BodyDetails.tsx
//
// Height, weight, age and sex (for BMI and BMR) and insulin use. Saved
// separately from the rest of the profile, so a server that has not had its
// database update yet can't block the other settings.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { bmiFrom, bmiLabel, bmrFrom, validateBody } from '@/lib/body';
import { getProfile, updateProfile, type InsulinType } from '@/services/api';

const INSULIN: { key: InsulinType; label: string; hint: string }[] = [
  { key: 'rapid', label: 'Rapid-acting', hint: 'Humalog, NovoRapid, Apidra' },
  { key: 'regular', label: 'Regular', hint: 'Humulin R, Actrapid' },
  { key: 'premixed', label: 'Premixed', hint: '70/30, Mixtard, NovoMix' },
  { key: 'other', label: 'Not sure', hint: 'Ask your doctor' },
];

function Choice<T extends string | boolean>({ value, options, onChange }: { value: T | null; options: { key: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={String(o.key)}
            onPress={() => onChange(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            style={[styles.choice, on && styles.choiceOn]}
          >
            <Text style={[styles.choiceText, on && { color: '#fff' }]}>{o.label}</Text>
            {o.hint ? <Text style={[styles.choiceHint, on && { color: '#DCE9FF' }]}>{o.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function BodyDetails({ hasDiabetes }: { hasDiabetes: boolean }) {
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [year, setYear] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [takes, setTakes] = useState<boolean | null>(null);
  const [type, setType] = useState<InsulinType | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setHeight(p.height_cm ? String(p.height_cm) : '');
        setWeight(p.weight_kg ? String(p.weight_kg) : '');
        setYear(p.birth_year ? String(p.birth_year) : '');
        setSex(p.sex ?? null);
        setTakes(p.mealtime_insulin ?? null);
        setType(p.insulin_type ?? null);
      })
      .catch(() => {});
  }, []);

  const h = parseFloat(height);
  const w = parseFloat(weight);
  const y = parseInt(year, 10);
  const bmi = bmiFrom(h, w);
  const age = Number.isFinite(y) ? new Date().getFullYear() - y : null;
  const bmr = bmrFrom(sex, age, h, w);

  const save = async () => {
    const problem = validateBody({ height: h, weight: w, year: y, sex });
    if (problem) return setNote({ ok: false, text: problem });
    setSaving(true);
    setNote(null);
    try {
      await updateProfile({
        height_cm: h,
        weight_kg: w,
        birth_year: y,
        sex: sex!,
        ...(takes !== null ? { mealtime_insulin: hasDiabetes && takes } : {}),
        ...(hasDiabetes && takes && type ? { insulin_type: type } : {}),
      });
      setNote({ ok: true, text: 'Saved.' });
    } catch {
      setNote({ ok: false, text: 'Could not save. Check your internet and try again.' });
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { label: 'Height', unit: 'cm', value: height, set: setHeight },
    { label: 'Weight', unit: 'kg', value: weight, set: setWeight },
    { label: 'Birth year', unit: '', value: year, set: setYear },
  ];

  return (
    <>
      <SectionHeader title="Your body" />
      <Card>
        <View style={styles.grid}>
          {fields.map((f) => (
            <View key={f.label} style={{ flex: 1 }}>
              <Text style={styles.label}>{f.label}</Text>
              <View style={styles.box}>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={f.value}
                  onChangeText={f.set}
                  maxLength={5}
                  accessibilityLabel={f.unit ? `${f.label} in ${f.unit}` : f.label}
                />
                {f.unit ? <Text style={styles.unit}>{f.unit}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 14 }]}>Sex</Text>
        <Choice value={sex} onChange={setSex} options={[{ key: 'male', label: 'Male' }, { key: 'female', label: 'Female' }]} />

        {bmi ? (
          <View style={styles.result}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultValue}>{bmi.toFixed(1)}</Text>
              <Text style={styles.caption}>BMI · {age !== null && age < 18 ? 'under 18: ask your doctor' : bmiLabel(bmi)}</Text>
            </View>
            {bmr ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.resultValue}>{bmr}</Text>
                <Text style={styles.caption}>BMR · kcal a day at rest</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {hasDiabetes ? (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>Has a doctor prescribed you insulin at meals?</Text>
            <Choice value={takes} onChange={setTakes} options={[{ key: true, label: 'Yes' }, { key: false, label: 'No' }]} />
            {takes ? (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>Which mealtime insulin?</Text>
                <Choice value={type} onChange={setType} options={INSULIN} />
                {type && type !== 'rapid' ? (
                  <Text style={styles.warn}>Dose estimates only fit rapid-acting insulin, so none will be shown. Everything else still works.</Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {note ? <Text style={[styles.note, { color: note.ok ? colors.successText : colors.dangerText }]}>{note.text}</Text> : null}
        <Button label="Save body details" icon="checkmark" size="md" onPress={save} loading={saving} style={{ marginTop: 14 }} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 14.5, fontWeight: '700', color: colors.textMuted, marginBottom: 8 },
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 54 },
  input: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: '800', color: colors.text, paddingVertical: 10, ...tabular },
  unit: { fontSize: 13.5, fontWeight: '700', color: colors.textFaint },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flexGrow: 1, minWidth: '45%', minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 15, fontWeight: '700', color: colors.text },
  choiceHint: { fontSize: 13, color: colors.textFaint, marginTop: 1 },
  result: { flexDirection: 'row', gap: 12, backgroundColor: colors.primaryPale, borderRadius: radius.md, padding: 14, marginTop: 14 },
  resultValue: { fontSize: 24, fontWeight: '800', color: colors.text, ...tabular },
  caption: { fontSize: 13, color: colors.textMuted },
  warn: { fontSize: 14, lineHeight: 20, color: colors.warningText, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: 12, marginTop: 10 },
  note: { fontSize: 14.5, fontWeight: '700', marginTop: 12 },
});
