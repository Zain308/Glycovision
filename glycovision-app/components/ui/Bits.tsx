// components/ui/Bits.tsx
//
// Small shared pieces: section headers, status pills, icon badges and
// stat tiles. Status is always shown with an icon and a word as well as
// a colour, so it still reads for colour-blind users.

import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { colors, radius, tabular, TOUCH } from '@/constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';

export const toneColors: Record<Tone, { fg: string; bg: string; strong: string }> = {
  success: { fg: colors.successText, bg: colors.successSoft, strong: colors.success },
  warning: { fg: colors.warningText, bg: colors.warningSoft, strong: colors.warning },
  danger: { fg: colors.dangerText, bg: colors.dangerSoft, strong: colors.danger },
  info: { fg: colors.info, bg: colors.infoSoft, strong: colors.info },
  brand: { fg: colors.primary, bg: colors.primarySoft, strong: colors.primary },
  neutral: { fg: colors.textMuted, bg: colors.surfaceMuted, strong: colors.textMuted },
};

// ---------------------------------------------------------------------

export function SectionHeader({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={styles.sectionAction}
        >
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------

export function StatusPill({
  tone,
  label,
  icon,
  style,
}: {
  tone: Tone;
  label: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, style]}>
      {icon ? <Ionicons name={icon} size={15} color={t.fg} /> : null}
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------

export function IconBadge({
  icon,
  tone = 'brand',
  size = 44,
  renderIcon,
}: {
  icon?: IconName;
  tone?: Tone;
  size?: number;
  // For icons from other families (e.g. MaterialCommunityIcons).
  renderIcon?: (color: string, size: number) => React.ReactNode;
}) {
  const t = toneColors[tone];
  const iconSize = Math.round(size * 0.48);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        backgroundColor: t.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {renderIcon ? renderIcon(t.strong, iconSize) : icon ? <Ionicons name={icon} size={iconSize} color={t.strong} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  tone = 'brand',
  icon,
  renderIcon,
  style,
  caption,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  icon?: IconName;
  renderIcon?: (color: string, size: number) => React.ReactNode;
  style?: StyleProp<ViewStyle>;
  caption?: string;
}) {
  return (
    <View
      style={[styles.tile, style]}
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ' ' + unit : ''}`}
    >
      <IconBadge icon={icon} tone={tone} size={36} renderIcon={renderIcon} />
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
      {caption ? <Text style={styles.tileCaption}>{caption}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: colors.divider, marginVertical: 14 }, style]} />;
}

// A tappable list row with icon, title, optional detail and chevron.
export function ListRow({
  icon,
  tone = 'brand',
  title,
  detail,
  onPress,
  right,
}: {
  icon: IconName;
  tone?: Tone;
  title: string;
  detail?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}
    >
      <IconBadge icon={icon} tone={tone} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {detail ? <Text style={styles.listDetail}>{detail}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textFaint} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  sectionActionText: { fontSize: 15, fontWeight: '700', color: colors.primary },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: 13.5, fontWeight: '700' },

  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
    minHeight: 128,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4, ...tabular },
  tileUnit: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  tileLabel: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  tileCaption: { fontSize: 13, color: colors.textFaint },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH + 12,
    paddingVertical: 8,
  },
  listTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  listDetail: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
});
