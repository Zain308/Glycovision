// app/library.tsx (opens over the tabs, from Scanner or Profile)
//
// Food library: look up carbs without a photo. Values come from the
// backend nutrition table (INDB + USDA, per typical portion); tap a dish
// for details and its source, or send its carbs straight to Bolus.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/Bits';
import { colors, radius, tabular } from '@/constants/theme';
import { getFoodLibrary, type LibraryFood } from '@/services/api';

// Carbs per portion, for a quick "how carby is this" label.
const carbLevel = (g: number) =>
  g >= 45 ? { label: 'High carb', tone: 'warning' as const } : g >= 15 ? { label: 'Medium carb', tone: 'info' as const } : { label: 'Low carb', tone: 'success' as const };

export default function LibraryScreen() {
  const [foods, setFoods] = useState<LibraryFood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (foods) return;
      getFoodLibrary()
        .then(setFoods)
        .catch(() => setError("Couldn't load the food library. Check your connection."));
    }, [foods]),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (foods ?? []).filter((f) => !q || f.display_name.toLowerCase().includes(q));
  }, [foods, search]);

  return (
    <Screen
      title="Food library"
      subtitle="Carbs for a typical portion. Tap a dish for details."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search: biryani, roti, chai…"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search foods"
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text style={styles.message}>{error}</Text>
      ) : !foods ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : filtered.length === 0 ? (
        <Text style={styles.message}>No dish matches "{search}".</Text>
      ) : (
        filtered.map((f) => {
          const isOpen = open === f.food_name;
          const level = carbLevel(f.per_portion.carbs);
          return (
            <Card key={f.food_name} style={styles.item}>
              <Pressable
                onPress={() => setOpen(isOpen ? null : f.food_name)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={`${f.display_name}, ${f.per_portion.carbs} grams carbs per ${f.portion.unit}`}
                style={styles.row}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.display_name}</Text>
                  <Text style={styles.portion}>
                    1 {f.portion.unit} · {Math.round(f.portion.unit_grams)} g
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.carbs}>
                    {Math.round(f.per_portion.carbs)}
                    <Text style={styles.carbsUnit}> g carbs</Text>
                  </Text>
                </View>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textFaint} />
              </Pressable>

              {isOpen && (
                <View style={styles.details}>
                  <StatusPill tone={level.tone} label={level.label} />
                  <View style={styles.macroRow}>
                    {[
                      { l: 'Calories', v: Math.round(f.per_portion.calories) },
                      { l: 'Protein', v: `${f.per_portion.protein} g` },
                      { l: 'Fat', v: `${f.per_portion.fat} g` },
                      { l: 'Fibre', v: `${f.per_portion.fiber} g` },
                    ].map((m) => (
                      <View key={m.l} style={styles.macro}>
                        <Text style={styles.macroVal}>{m.v}</Text>
                        <Text style={styles.macroLabel}>{m.l}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.source}>
                    Source ({f.match}): {f.source}
                  </Text>
                  <Button
                    label="Use these carbs in Bolus"
                    icon="calculator"
                    size="md"
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/(tabs)/bolus', params: { prefillCarbs: String(Math.round(f.per_portion.carbs)) } })
                    }
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    minHeight: 54,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16.5, color: colors.text, paddingVertical: 12 },
  message: { fontSize: 15.5, color: colors.textMuted, textAlign: 'center', marginTop: 30 },
  item: { paddingVertical: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  portion: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  carbs: { fontSize: 22, fontWeight: '800', color: colors.text, ...tabular },
  carbsUnit: { fontSize: 13.5, fontWeight: '600', color: colors.textMuted },
  details: { marginTop: 14, gap: 12 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macro: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  macroVal: { fontSize: 16, fontWeight: '800', color: colors.text, ...tabular },
  macroLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  source: { fontSize: 13, color: colors.textFaint, lineHeight: 18 },
});
