// components/LogBgSheet.tsx
//
// Bottom sheet for logging a blood sugar reading. Large number field,
// live status ("In range", "High") as the user types, inline validation
// instead of pop-up alerts, and a big Save button within thumb reach.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Bits';
import { Text, TextInput } from '@/components/ui/Typography';
import { colors, radius, tabular } from '@/constants/theme';
import { glucoseStatus } from '@/lib/glucose';

interface Props {
  visible: boolean;
  onClose: () => void;
  // Resolves when saved; throw to keep the sheet open.
  onSave: (value: number) => Promise<void>;
  lastValue?: number | null;
}

export function LogBgSheet({ visible, onClose, onSave, lastValue }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  // Two quick taps can both run before the re-render that disables Save.
  const savingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setText('');
      setError(null);
    }
  }, [visible]);

  const value = parseFloat(text);
  const status = useMemo(
    () => (Number.isFinite(value) && value > 20 && value < 600 ? glucoseStatus(value) : null),
    [value],
  );

  const save = async () => {
    if (savingRef.current) return;
    if (!Number.isFinite(value) || value <= 20 || value >= 600) {
      setError('Enter a reading between 20 and 600 mg/dL.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(value);
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text style={styles.title} accessibilityRole="header">
              Log blood sugar
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.sub}>From your meter or sensor, in mg/dL.</Text>

          <View style={[styles.inputWrap, focused && styles.inputFocused, error ? styles.inputError : null]}>
            <TextInput
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={styles.input}
              value={text}
              onChangeText={(t) => {
                setText(t.replace(/[^0-9.]/g, ''));
                setError(null);
              }}
              keyboardType="decimal-pad"
              placeholder="120"
              placeholderTextColor={colors.textFaint}
              autoFocus
              maxLength={5}
              accessibilityLabel="Blood sugar in milligrams per decilitre"
              returnKeyType="done"
              onSubmitEditing={save}
            />
            <Text style={styles.unit}>mg/dL</Text>
          </View>

          <View style={styles.feedback}>
            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color={colors.dangerText} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : status ? (
              <StatusPill tone={status.tone} icon={status.icon} label={status.label} />
            ) : lastValue != null ? (
              <Text style={styles.hint}>Last reading: {lastValue} mg/dL</Text>
            ) : null}
          </View>

          <Button label="Save reading" icon="checkmark" onPress={save} loading={saving} disabled={!text} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,27,45,0.45)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  sub: { fontSize: 15, color: colors.textMuted, marginTop: 4, marginBottom: 18 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    backgroundColor: colors.input,
    borderRadius: radius.lg,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputFocused: { borderColor: colors.primary },
  inputError: { borderColor: colors.danger },
  input: {
    fontSize: 52,
    fontWeight: '800',
    color: colors.text,
    width: 150,
    textAlign: 'right',
    paddingVertical: 0,
    paddingHorizontal: 6,
    ...tabular,
    // Web draws its own focus box; the wrapper's blue border shows focus instead.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  unit: { fontSize: 18, fontWeight: '700', color: colors.textMuted },
  feedback: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginVertical: 10 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 14.5, color: colors.dangerText, fontWeight: '600' },
  hint: { fontSize: 14.5, color: colors.textMuted },
});
