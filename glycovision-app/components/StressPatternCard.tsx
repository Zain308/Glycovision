// components/StressPatternCard.tsx
//
// Stress over the last 7 days (is it ongoing?) and what stress has done to
// this user's own sugar. Shown on the Voice screen. Advice only: it never
// changes a dose.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { ResearchNote } from '@/components/ui/ResearchNote';
import { colors, radius } from '@/constants/theme';
import type { StressPattern } from '@/services/api';

const PATTERN_LOOK = {
  ongoing: { icon: 'alert-circle' as const, color: colors.warning, soft: colors.warningSoft, label: 'Ongoing' },
  some: { icon: 'pulse' as const, color: colors.warning, soft: colors.warningSoft, label: 'Some stress' },
  calm: { icon: 'leaf' as const, color: colors.success, soft: colors.successSoft, label: 'Calm' },
  not_enough_checks: { icon: 'mic-outline' as const, color: colors.primary, soft: colors.primarySoft, label: 'Learning' },
};

const EFFECT_ICON = {
  raises: 'trending-up' as const,
  lowers: 'trending-down' as const,
  no_clear_effect: 'remove' as const,
  learning: 'hourglass-outline' as const,
};

export function StressPatternCard({ data }: { data: StressPattern }) {
  const { pattern, effect, advice } = data;
  const look = PATTERN_LOOK[pattern.status] ?? PATTERN_LOOK.not_enough_checks;
  const effectColor =
    effect.status === 'raises' || effect.status === 'lowers' ? colors.warning : colors.textMuted;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.iconCircle, { backgroundColor: look.soft }]}>
          <Ionicons name={look.icon} size={20} color={look.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{pattern.headline}</Text>
          <Text style={styles.meta}>Last {pattern.window_days} days · {pattern.checks} checks</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: look.soft }]}>
          <Text style={[styles.chipText, { color: look.color }]}>{look.label}</Text>
        </View>
      </View>
      <Text style={styles.summary}>{pattern.summary}</Text>

      <View style={styles.effectBox}>
        <View style={styles.row}>
          <Ionicons name={EFFECT_ICON[effect.status] ?? 'remove'} size={18} color={effectColor} />
          <Text style={[styles.effectTitle, { color: effectColor === colors.textMuted ? colors.text : effectColor }]}>
            {effect.headline}
          </Text>
        </View>
        <Text style={styles.summary}>{effect.summary}</Text>
      </View>

      {advice.length > 0 && (
        <View style={styles.list}>
          {advice.map((tip) => (
            <View key={tip} style={styles.listRow}>
              <Ionicons name="checkmark-circle" size={17} color={colors.primary} />
              <Text style={styles.listText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}

      <ResearchNote label="Experimental voice analysis" details={data.disclaimer} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  summary: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  effectBox: { gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.bg },
  effectTitle: { flex: 1, fontSize: 14.5, fontWeight: '700' },
  list: { gap: 8 },
  listRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  listText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
});
