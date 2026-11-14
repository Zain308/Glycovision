// components/StressContextCard.tsx
//
// Shows what a recent voice check means for the user and what to do next.
// Used on Voice (after a check), Dashboard and Bolus, which is what links
// the voice feature to glucose and insulin decisions. It gives advice; it
// never changes a dose.

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { ResearchNote } from '@/components/ui/ResearchNote';
import { colors, radius } from '@/constants/theme';
import type { StressContext } from '@/services/api';

interface Props {
  context: StressContext;
  // Compact shows the first two suggestions only (Dashboard).
  compact?: boolean;
  onLogBg?: () => void;
  onOpenBolus?: () => void;
  onVoiceCheck?: () => void;
}

const LOOK = {
  elevated: {
    icon: 'alert-circle' as const,
    color: colors.warning,
    soft: colors.warningSoft,
    label: 'Stress likely',
  },
  possible: {
    icon: 'pulse' as const,
    color: colors.warning,
    soft: colors.warningSoft,
    label: 'Possible stress',
  },
  calm: {
    icon: 'leaf' as const,
    color: colors.success,
    soft: colors.successSoft,
    label: 'Calm',
  },
};

export function ageLabel(minutes?: number): string {
  if (minutes == null) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

export function StressContextCard({
  context,
  compact,
  onLogBg,
  onOpenBolus,
  onVoiceCheck,
}: Props) {
  // No recent check: a small prompt to do one.
  if (context.status !== 'recent' || !context.level) {
    return (
      <View style={styles.emptyRow}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="mic-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>How are you feeling?</Text>
          <Text style={styles.meta}>
            A 10-second voice check adds stress context to your advice.
          </Text>
        </View>
        {onVoiceCheck && (
          <TouchableOpacity onPress={onVoiceCheck} style={styles.linkBtn}>
            <Text style={styles.linkText}>Check</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const look = LOOK[context.level];
  const stressed = context.level !== 'calm';
  const suggestions = compact
    ? context.suggestions.slice(0, 2)
    : context.suggestions;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={[styles.iconCircle, { backgroundColor: look.soft }]}>
          <Ionicons name={look.icon} size={20} color={look.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{context.headline}</Text>
          <Text style={styles.meta}>
            Voice check · {ageLabel(context.age_minutes)}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: look.soft }]}>
          <Text style={[styles.chipText, { color: look.color }]}>
            {look.label}
          </Text>
        </View>
      </View>

      <Text style={styles.summary}>{context.summary}</Text>

      {suggestions.length > 0 && (
        <View style={styles.list}>
          {suggestions.map((s) => (
            <View key={s} style={styles.listRow}>
              <Ionicons
                name="checkmark-circle"
                size={17}
                color={stressed ? colors.primary : colors.success}
              />
              <Text style={styles.listText}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {stressed && (onLogBg || onOpenBolus) && (
        <View style={styles.actions}>
          {onLogBg && (
            <TouchableOpacity style={styles.primaryBtn} onPress={onLogBg}>
              <Ionicons name="water" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Log blood sugar</Text>
            </TouchableOpacity>
          )}
          {onOpenBolus && (
            <TouchableOpacity style={styles.outlineBtn} onPress={onOpenBolus}>
              <Text style={styles.outlineBtnText}>Open Bolus</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!compact && context.disclaimer ? (
        <ResearchNote label="Experimental voice analysis" details={context.disclaimer} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 2,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  list: {
    gap: 8,
  },
  listRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  listText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    minHeight: 46,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  outlineBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.button,
    minHeight: 46,
  },
  outlineBtnText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  linkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  linkText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
