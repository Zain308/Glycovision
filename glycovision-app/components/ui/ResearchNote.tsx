// components/ui/ResearchNote.tsx
//
// One compact line for safety/research wording, replacing the large
// grey disclaimer boxes. The full text stays one tap away, so nothing
// is hidden from patients or examiners.

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { colors } from '@/constants/theme';

interface Props {
  // Short line shown by default, e.g. "Research estimate · not for dosing".
  label: string;
  // Full wording, shown when tapped.
  details?: string;
}

export function ResearchNote({ label, details }: Props) {
  const [open, setOpen] = useState(false);
  const expandable = !!details;

  return (
    <Pressable
      onPress={() => expandable && setOpen((v) => !v)}
      disabled={!expandable}
      style={styles.wrap}
      accessibilityRole={expandable ? 'button' : undefined}
      accessibilityState={expandable ? { expanded: open } : undefined}
      accessibilityHint={expandable ? 'Shows the full note' : undefined}
    >
      <View style={styles.row}>
        <Ionicons
          name="information-circle-outline"
          size={15}
          color={colors.textFaint}
        />
        <Text style={styles.label}>{label}</Text>
        {expandable && (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textFaint}
          />
        )}
      </View>
      {open && details ? <Text style={styles.details}>{details}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: 12.5,
    color: colors.textFaint,
  },
  details: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
    paddingLeft: 21,
  },
});
