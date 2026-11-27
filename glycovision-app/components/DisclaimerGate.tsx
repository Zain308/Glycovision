// components/DisclaimerGate.tsx
//
// Shown once after signing in, before anything else. The wording is a draft
// for the supervisor to approve.

import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { colors, radius } from '@/constants/theme';
import { updateProfile } from '@/services/api';

const KEY = 'gv.disclaimer.v1';

const POINTS = [
  'GlycoVision is a student research project, not a medical device. It can be wrong.',
  'It uses no medical hardware. Food amounts, forecasts and stress are estimates and can differ from your real values.',
  'Dose suggestions are not a prescription. Check your sugar and follow your doctor’s plan before you inject.',
  'In an emergency, such as fainting, vomiting or very high sugar with ketones, get medical help. Don’t wait for the app.',
  'Your readings, meals, activity and voice results are stored in your account. Voice recordings are deleted from the server after analysis.',
];

export function DisclaimerGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setOpen(v !== '1'))
      .catch(() => setOpen(true));
  }, []);

  const accept = async () => {
    setOpen(false);
    await AsyncStorage.setItem(KEY, '1').catch(() => {});
    updateProfile({ disclaimer_accepted_at: new Date().toISOString() }).catch(() => {});
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 8 }}>
            <Text style={styles.title} accessibilityRole="header">
              Before you start
            </Text>
            {POINTS.map((p) => (
              <View key={p} style={styles.row}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} />
                <Text style={styles.text}>{p}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: 22, paddingTop: 8 }}>
            <Button label="I understand" onPress={accept} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(13,26,46,0.45)', justifyContent: 'center', padding: 18 },
  sheet: { backgroundColor: colors.card, borderRadius: radius.xl, maxHeight: '88%' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  text: { flex: 1, fontSize: 15.5, lineHeight: 22, color: colors.textMuted },
});
