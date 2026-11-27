// app/report.tsx
// Doctor's report: choose the period, see the main numbers, share a PDF.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { reportHtml } from '@/lib/report';
import { getReport, type DoctorReport } from '@/services/api';

const PERIODS = [
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
];

export default function ReportScreen() {
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (d: number) => {
    const mine = ++request.current;
    setReport(null);
    setError(false);
    try {
      const r = await getReport(d);
      if (mine === request.current) setReport(r);
    } catch {
      if (mine === request.current) setError(true);
    }
  }, []);
  useEffect(() => {
    load(days);
  }, [days, load]);

  const share = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const html = reportHtml(report);
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share report with your doctor' });
      } else {
        await Print.printAsync({ html });
      }
      haptic.success();
    } catch (e) {
      console.log('Report failed', e);
      Alert.alert('Could not make the PDF', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const g = report?.glucose;
  const rows: [string, string][] = report
    ? [
        ['Average sugar', g?.count ? `${g.average} mg/dL` : 'no readings'],
        [g?.sensor ? 'Time in range' : 'Readings in range', g?.count ? `${g.in_range}%` : '–'],
        ['Below 70', g?.count ? `${((g.low ?? 0) + (g.very_low ?? 0)).toFixed(1)}%` : '–'],
        ['Readings', `${g?.count ?? 0}`],
        ['Steps a day', report.activity.steps_per_day?.toLocaleString() ?? '–'],
        ['Medicines taken (7 days)', report.adherence.percent != null ? `${report.adherence.percent}%` : '–'],
      ]
    : [];

  return (
    <Screen
      title="Doctor's report"
      subtitle="One PDF with your sugar, medicines and habits."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      <View style={styles.periods}>
        {PERIODS.map((p) => (
          <Pressable key={p.days} onPress={() => setDays(p.days)} accessibilityRole="radio" accessibilityState={{ selected: days === p.days }} style={[styles.period, days === p.days && styles.periodOn]}>
            <Text style={[styles.periodText, days === p.days && { color: '#fff' }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        {report ? (
          rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i > 0 && styles.line]}>
              <Text style={styles.key}>{k}</Text>
              <Text style={styles.value}>{v}</Text>
            </View>
          ))
        ) : error ? (
          <>
            <Text style={styles.body}>The report isn’t available right now. Check your internet and try again.</Text>
            <Button label="Try again" icon="refresh" size="md" variant="secondary" onPress={() => load(days)} style={{ marginTop: 12 }} />
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Card>
      <Button label="Share PDF" icon="share-outline" onPress={share} loading={busy} disabled={!report} />
      <Text style={styles.note}>The PDF has your name and health details. Share it only with people you trust.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  periods: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  period: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  periodOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodText: { fontSize: 15, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 46 },
  line: { borderTopWidth: 1, borderTopColor: colors.divider },
  key: { flex: 1, fontSize: 15, color: colors.textMuted },
  value: { fontSize: 16.5, fontWeight: '800', color: colors.text, ...tabular },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  note: { fontSize: 13.5, lineHeight: 19, color: colors.textFaint, marginTop: 12, textAlign: 'center' },
});
