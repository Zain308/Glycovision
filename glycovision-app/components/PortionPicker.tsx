// components/PortionPicker.tsx
import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Text, TextInput } from "@/components/ui/Typography";
import { colors, radius, shadow } from "@/constants/theme";
import {
  PortionInfo,
  MAX_PORTION_GRAMS,
  describePortion,
  parseGrams,
  portionLabel,
  quickMultipliers,
} from "@/lib/portion";

interface Props {
  portion: PortionInfo;
  grams: number;
  onChange: (grams: number) => void;
}

export function PortionPicker({ portion, grams, onChange }: Props) {
  const [gramsText, setGramsText] = useState("");
  const usingCustom = gramsText.trim() !== "";
  const customInvalid = usingCustom && parseGrams(gramsText) === null;

  const choose = (multiplier: number) => {
    setGramsText("");
    onChange(multiplier * portion.unit_grams);
  };

  const typeGrams = (text: string) => {
    setGramsText(text);
    const parsed = parseGrams(text);
    if (parsed !== null) {
      onChange(parsed);
    } else if (!text.trim()) {
      // Cleared the box: go back to one unit.
      onChange(portion.unit_grams);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.question}>How much did you eat?</Text>

      <View style={styles.chips}>
        {quickMultipliers(portion).map((multiplier) => {
          const selected =
            !usingCustom &&
            Math.abs(grams - multiplier * portion.unit_grams) < 0.01;
          return (
            <TouchableOpacity
              key={multiplier}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => choose(multiplier)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {portionLabel(portion, multiplier)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.gramsRow}>
        <Text style={styles.gramsLabel}>Or enter grams</Text>
        <TextInput
          style={[styles.gramsInput, customInvalid && styles.gramsInputInvalid]}
          value={gramsText}
          onChangeText={typeGrams}
          keyboardType="decimal-pad"
          placeholder={String(Math.round(portion.unit_grams))}
          placeholderTextColor="#9CA3AF"
          maxLength={5}
          accessibilityLabel="Portion in grams"
        />
        <Text style={styles.gramsUnit}>g</Text>
      </View>

      {customInvalid ? (
        <Text style={styles.error}>
          Enter a weight between 1 and {MAX_PORTION_GRAMS} g.
        </Text>
      ) : (
        <Text style={styles.summary}>
          Your portion: {describePortion(portion, grams)}
        </Text>
      )}

      <Text style={styles.hint}>
        1 {portion.unit} is taken as about {Math.round(portion.unit_grams)} g.
        If yours is bigger or smaller, enter grams instead.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 14,
    gap: 12,
    ...shadow.card,
  },
  question: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 44,
    minWidth: 56,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 15.5,
    fontWeight: "700",
    color: colors.text,
  },
  chipTextSelected: {
    color: "#FFFFFF",
  },
  gramsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  gramsLabel: {
    flex: 1,
    fontSize: 14.5,
    color: colors.textMuted,
  },
  gramsInput: {
    width: 88,
    minHeight: 44,
    backgroundColor: colors.input,
    borderWidth: 1.5,
    borderColor: "transparent",
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    color: colors.text,
  },
  gramsInputInvalid: {
    borderColor: colors.danger,
  },
  gramsUnit: {
    fontSize: 15,
    color: colors.textMuted,
  },
  summary: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  error: {
    fontSize: 14,
    color: colors.dangerText,
  },
  hint: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textFaint,
  },
});
