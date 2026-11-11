// components/PortionPicker.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from "react-native";
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
    backgroundColor: "#F5F3FF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    gap: 10,
  },
  question: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    backgroundColor: "#FFFFFF",
  },
  chipSelected: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#5B21B6",
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
    fontSize: 13.5,
    color: "#4B5563",
  },
  gramsInput: {
    width: 80,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    textAlign: "right",
    color: "#111827",
  },
  gramsInputInvalid: {
    borderColor: "#EF4444",
  },
  gramsUnit: {
    fontSize: 14,
    color: "#4B5563",
  },
  summary: {
    fontSize: 13.5,
    fontWeight: "600",
    color: "#5B21B6",
  },
  error: {
    fontSize: 13.5,
    color: "#DC2626",
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
    color: "#6B7280",
  },
});
