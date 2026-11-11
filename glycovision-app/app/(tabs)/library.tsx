// app/(tabs)/library.tsx
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';

const FOODS = [
  { name: 'Chicken Biryani', cuisine: 'Pakistani', gi: 68, carbs: 62, protein: 22, fat: 18, cal: 486, per: '250g' },
  { name: 'Chicken Karahi', cuisine: 'Pakistani', gi: 15, carbs: 8, protein: 42, fat: 28, cal: 452, per: '300g' },
  { name: 'Naan', cuisine: 'Pakistani', gi: 71, carbs: 45, protein: 9, fat: 6, cal: 262, per: '100g' },
  { name: 'Dal', cuisine: 'Pakistani', gi: 29, carbs: 28, protein: 12, fat: 4, cal: 180, per: '200g' },
  { name: 'Chapli Kebab', cuisine: 'Pakistani', gi: 0, carbs: 5, protein: 28, fat: 22, cal: 320, per: '150g' },
];

export default function LibraryScreen() {
  const [search, setSearch] = useState('');

  const filtered = FOODS.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>Food Library</Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search library..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      {filtered.map((f, i) => (
        <Card key={i}>
          <View style={styles.foodHeader}>
            <Text style={styles.foodName}>{f.name}</Text>
            <View style={styles.cuisineBadge}>
              <Text style={styles.cuisineText}>{f.cuisine} · GI:{f.gi}</Text>
            </View>
          </View>

          <View style={styles.macroRow}>
            <View style={styles.mItem}><Text style={styles.mLabel}>C</Text><Text style={styles.mVal}>{f.carbs}</Text></View>
            <View style={styles.mItem}><Text style={styles.mLabel}>P</Text><Text style={styles.mVal}>{f.protein}</Text></View>
            <View style={styles.mItem}><Text style={styles.mLabel}>F</Text><Text style={styles.mVal}>{f.fat}</Text></View>
            <View style={styles.mItem}><Text style={styles.mLabel}>Cal</Text><Text style={styles.mVal}>{f.cal}</Text></View>
          </View>
          <Text style={styles.per}>per {f.per}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7FF' },
  title: { fontSize: 24, fontWeight: '700', marginTop: 40, marginBottom: 16, color: '#111827' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18,
    borderWidth: 1, borderColor: '#E5E7EB', gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },

  foodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  foodName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  cuisineBadge: { backgroundColor: '#EDE9FE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  cuisineText: { fontSize: 11, color: '#7C3AED', fontWeight: '600' },

  macroRow: { flexDirection: 'row', gap: 10 },
  mItem: { backgroundColor: '#F3F4F6', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', minWidth: 58 },
  mLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  mVal: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  per: { fontSize: 12, color: '#9CA3AF', marginTop: 10 },
});