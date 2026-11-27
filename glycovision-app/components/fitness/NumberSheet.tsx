// components/fitness/NumberSheet.tsx
// Bottom sheet to enter one or two numbers (weight, blood pressure, goals…).

import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Text, TextInput } from '@/components/ui/Typography';
import { colors, radius, tabular } from '@/constants/theme';

export type NumberField = { label: string; unit: string; min: number; max: number; placeholder: string; initial?: string };

export function NumberSheet({
  title,
  note,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  note?: string;
  fields: NumberField[];
  onClose: () => void;
  /** Throw to keep the sheet open. */
  onSave: (values: number[]) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [texts, setTexts] = useState(fields.map((f) => f.initial ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const save = async () => {
    if (savingRef.current) return;
    const values = texts.map((t) => Number(t.replace(',', '.')));
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!texts[i] || !Number.isFinite(values[i]) || values[i] < f.min || values[i] > f.max) {
        setError(`${f.label} must be between ${f.min.toLocaleString()} and ${f.max.toLocaleString()}.`);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
    } catch (e) {
      const text = e instanceof Error && e.message.startsWith('!') ? e.message.slice(1) : 'Could not save. Check your internet and try again.';
      if (alive.current) setError(text);
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {fields.map((f, i) => (
            <View key={f.label} style={styles.field}>
              <Text style={styles.label}>{f.label}</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={texts[i]}
                  onChangeText={(t) => {
                    setTexts(texts.map((old, j) => (j === i ? t.replace(/[^0-9.,]/g, '') : old)));
                    setError(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.textFaint}
                  autoFocus={i === 0}
                  maxLength={6}
                  accessibilityLabel={`${f.label} in ${f.unit}`}
                />
                <Text style={styles.unit}>{f.unit}</Text>
              </View>
            </View>
          ))}
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Save" icon="checkmark" onPress={save} loading={saving} style={{ marginTop: 16 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,27,45,0.45)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 22, paddingTop: 18 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  title: { fontSize: 21, fontWeight: '800', color: colors.text },
  note: { fontSize: 14.5, lineHeight: 20, color: colors.textMuted },
  field: { marginTop: 14 },
  label: { fontSize: 14, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.input, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 58 },
  input: { flex: 1, fontSize: 24, fontWeight: '800', color: colors.text, ...tabular, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', minWidth: 0 } as object) : null) },
  unit: { fontSize: 16, fontWeight: '700', color: colors.textMuted },
  error: { fontSize: 14.5, fontWeight: '700', color: colors.dangerText, marginTop: 12 },
});
