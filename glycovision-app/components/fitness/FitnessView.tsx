// components/fitness/FitnessView.tsx
//
// Everything on the Fitness tab, drawn from one /fitness answer. Order: are
// you active today -> the rings -> the numbers -> when you moved and sat ->
// the week -> what activity does to your sugar -> sleep and body -> journal.

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Bits';
import { ResearchNote } from '@/components/ui/ResearchNote';
import { ActivityRings } from '@/components/fitness/ActivityRings';
import { BarChart } from '@/components/fitness/BarChart';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { timeAgo } from '@/lib/glucose';
import { average, formatMetric, metricValue, METRICS, minutesText, type MetricKey } from '@/lib/fitness';
import type { Fitness, VitalKind } from '@/services/api';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Words carry the meaning; the colour only supports it. Not red: sitting is
// not an emergency.
const DAY_LOOK: Record<Fitness['status']['level'], { icon: IconName; bg: string; fg: string }> = {
  active: { icon: 'trophy-outline', bg: colors.successSoft, fg: colors.successText },
  on_track: { icon: 'trending-up', bg: colors.successSoft, fg: colors.successText },
  low: { icon: 'walk-outline', bg: colors.warningSoft, fg: colors.warningText },
  sitting: { icon: 'hourglass-outline', bg: colors.warningSoft, fg: colors.warningText },
  early: { icon: 'sunny-outline', bg: colors.primarySoft, fg: colors.primaryDark },
  unknown: { icon: 'help-circle-outline', bg: colors.surfaceMuted, fg: colors.textMuted },
};

const hourName = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

function Stat({ icon, value, unit, label, note }: { icon: IconName; value: string; unit?: string; label: string; note?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value} ${unit ?? ''} ${note ?? ''}`}>
      <Ionicons name={icon} size={19} color={colors.primary} />
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.caption}>{label}</Text>
      {note ? <Text style={styles.caption}>{note}</Text> : null}
    </View>
  );
}

function VitalRow({ icon, title, value, note, warn, onPress }: { icon: IconName; title: string; value: string; note?: string; warn?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}: ${value}. ${note ?? ''} Add`} style={({ pressed }) => [styles.vital, pressed && { opacity: 0.7 }]}>
      <View style={styles.vitalIcon}>
        <Ionicons name={icon} size={21} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.vitalTitle}>{title}</Text>
        {note ? <Text style={[styles.caption, warn && { color: colors.warningText, fontWeight: '700' }]}>{note}</Text> : null}
      </View>
      <Text style={styles.vitalValue}>{value}</Text>
      <Ionicons name="add-circle-outline" size={23} color={colors.primary} />
    </Pressable>
  );
}

export function FitnessView({
  data,
  connected,
  onConnect,
  onWorkout,
  onAdd,
  onGoals,
  onVital,
  onDelete,
  onVoice,
}: {
  data: Fitness;
  /** Automatic data is on, or can't be used on this phone. */
  connected: boolean;
  onConnect: () => void;
  onWorkout: () => void;
  onAdd: () => void;
  onGoals: () => void;
  onVital: (kind: VitalKind) => void;
  onDelete: (id: number, name: string) => void;
  onVoice: () => void;
}) {
  const [metric, setMetric] = useState<MetricKey>('steps');
  const [range, setRange] = useState<7 | 30>(7);
  const { today, goals, status, week, vitals, sleep } = data;
  const look = DAY_LOOK[status.level];
  const dayGoal = Math.max(1, Math.round(goals.heart_pts / 7));

  const shown = data.days.slice(-range);
  const info = METRICS.find((m) => m.key === metric)!;
  const avg = average(shown, metric);
  const items = shown.map((d, i) => {
    const date = new Date(`${d.day}T12:00:00`);
    return {
      label: date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
      axis: range === 7 ? date.toLocaleDateString([], { weekday: 'short' }).slice(0, 2) : i % 7 === 1 ? String(date.getDate()) : undefined,
      value: metricValue(d, metric),
    };
  });
  const goal = metric === 'steps' ? goals.steps : metric === 'heart_pts' ? dayGoal : null;
  const share = Math.min(1, week.heart_pts / Math.max(1, week.goal));
  const weights = data.weight_history;
  const weightChange = weights.length > 1 ? weights[weights.length - 1].value - weights[0].value : null;
  const anyHour = today.hourly.some((h) => h > 0);
  const effect = data.sugar_effect;

  return (
    <View>
      {/* ARE YOU ACTIVE? */}
      <View style={[styles.banner, { backgroundColor: look.bg }]}>
        <Ionicons name={look.icon} size={28} color={look.fg} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerTitle, { color: look.fg }]} accessibilityRole="header">
            {status.title}
          </Text>
          <Text style={[styles.bannerText, { color: look.fg }]}>{status.text}</Text>
        </View>
      </View>

      <Card>
        <ActivityRings steps={today.steps} stepGoal={goals.steps} points={today.heart_pts} pointGoal={dayGoal} />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text style={styles.caption}>Steps</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.heart }]} />
            <Text style={styles.caption}>Heart Points</Text>
          </View>
          <Pressable onPress={onGoals} hitSlop={10} accessibilityRole="button" style={styles.legendItem}>
            <Ionicons name="create-outline" size={16} color={colors.primary} />
            <Text style={styles.link}>Goals</Text>
          </Pressable>
        </View>
        <View style={styles.stats}>
          <Stat icon="timer-outline" value={today.move_min != null ? String(today.move_min) : '–'} unit="min" label="Move Minutes" />
          <Stat icon="map-outline" value={today.distance_m != null ? (today.distance_m / 1000).toFixed(1) : '–'} unit="km" label="Distance" note={today.distance_estimated && today.distance_m ? 'estimated' : undefined} />
          <Stat icon="flame-outline" value={today.active_kcal != null ? String(today.active_kcal) : '–'} unit="kcal" label="Calories" note={today.kcal_estimated && today.active_kcal ? 'estimated' : undefined} />
        </View>
        <View style={styles.buttons}>
          <Button label="Workout" icon="play" size="md" onPress={onWorkout} containerStyle={{ flex: 1 }} />
          <Button label="Add" icon="add" size="md" variant="secondary" onPress={onAdd} containerStyle={{ flex: 1 }} />
        </View>
        {!connected ? (
          <Pressable onPress={onConnect} accessibilityRole="button" style={styles.connect}>
            <Ionicons name="link-outline" size={20} color={colors.primary} />
            <Text style={styles.connectText}>Count my steps automatically, all day</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
        ) : today.last_sync ? (
          <Text style={[styles.caption, { textAlign: 'center', marginTop: 10 }]}>Updated {timeAgo(today.last_sync)?.toLowerCase()}</Text>
        ) : null}
      </Card>

      {/* WHEN YOU MOVED */}
      <SectionHeader title="Your day, hour by hour" />
      <Card>
        {anyHour ? (
          <BarChart
            items={today.hourly.map((v, h) => ({ label: hourName(h), axis: h % 6 === 0 ? hourName(h) : undefined, value: v }))}
            format={(v) => `${v?.toLocaleString()} steps`}
            summary={`${today.active_hours ?? 0} active ${today.active_hours === 1 ? 'hour' : 'hours'} today`}
            height={130}
          />
        ) : (
          <Text style={styles.body}>Your steps for each hour will show here.</Text>
        )}
        <View style={styles.sitRow}>
          <View style={styles.sitItem}>
            <Text style={styles.sitValue}>{today.sitting_min != null ? minutesText(today.sitting_min) : '–'}</Text>
            <Text style={styles.caption}>still now</Text>
          </View>
          <View style={styles.sitItem}>
            <Text style={styles.sitValue}>{today.longest_sit_min != null ? minutesText(today.longest_sit_min) : '–'}</Text>
            <Text style={styles.caption}>longest still today</Text>
          </View>
        </View>
        {(today.sitting_min ?? 0) >= 30 ? <Text style={[styles.body, { marginTop: 10 }]}>Stand up and walk for 3 minutes. Breaking up sitting every 30 minutes helps your sugar. If your sugar is low, treat it first.</Text> : null}
        <ResearchNote
          label="How this is measured"
          details="An active hour has 250 steps or more. Still means under 25 steps in 5 minutes, between 8 AM and 10 PM. If you leave your phone behind and have no watch, that time also looks still."
        />
      </Card>

      {/* THE WEEK */}
      <SectionHeader title="Are you physically active?" />
      <Card>
        <Text style={styles.verdict}>{week.title}</Text>
        <Text style={styles.body}>{week.text}</Text>
        <View style={styles.progressRow}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(share * 100)}%` as any }]} />
          </View>
          <Text style={styles.progressText}>
            {week.heart_pts} / {week.goal}
          </Text>
        </View>
        <Text style={styles.caption}>Heart Points, last 7 days</Text>
        <View style={styles.stats}>
          <Stat icon="calendar-outline" value={`${week.active_days} of 7`} label="active days" />
          <Stat icon="footsteps-outline" value={week.average_steps != null ? week.average_steps.toLocaleString() : '–'} label="steps a day" />
          <Stat icon="ribbon-outline" value={`${data.streak}`} unit={data.streak === 1 ? 'day' : 'days'} label="goal streak" />
        </View>
        <ResearchNote
          label="What are Heart Points?"
          details="1 point for each minute of brisk walking (100 steps a minute) and 2 for vigorous activity, the way Google Fit counts. 150 a week matches the World Health Organization’s and the American Diabetes Association’s advice of 150 minutes of moderate activity, with no more than 2 days in a row without any."
        />
      </Card>

      <SectionHeader title="History" />
      <Card>
        <View style={styles.rangeRow}>
          {([7, 30] as const).map((r) => (
            <Pressable key={r} onPress={() => setRange(r)} accessibilityRole="radio" accessibilityState={{ selected: r === range }} style={[styles.rangeBtn, r === range && styles.rangeOn]}>
              <Text style={[styles.rangeText, r === range && { color: colors.text }]}>{r === 7 ? 'Week' : 'Month'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.chips}>
          {METRICS.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => {
                haptic.select();
                setMetric(m.key);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: m.key === metric }}
              style={[styles.chip, m.key === metric && styles.chipOn]}
            >
              <Text style={[styles.chipText, m.key === metric && { color: '#fff' }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        <BarChart
          key={`${metric}${range}`}
          items={items}
          goal={goal}
          color={metric === 'heart_pts' || metric === 'hr_resting' ? colors.heart : colors.primary}
          format={(v) => `${formatMetric(v, metric)} ${info.unit}`}
          summary={avg == null ? 'No data yet' : `Average ${formatMetric(avg, metric)} ${info.unit} a day`}
          height={170}
        />
      </Card>

      {/* ACTIVITY AND SUGAR */}
      <SectionHeader title="What activity does to your sugar" />
      <Card>
        {effect.status !== 'learning' ? (
          <View style={styles.compare}>
            <View style={styles.compareItem}>
              <Text style={styles.compareValue}>{effect.quiet_avg}</Text>
              <Text style={styles.caption}>mg/dL on quiet days</Text>
              <Text style={styles.caption}>{effect.quiet_steps?.toLocaleString()} steps</Text>
            </View>
            <Ionicons name="arrow-forward" size={24} color={colors.textFaint} />
            <View style={styles.compareItem}>
              <Text style={styles.compareValue}>{effect.busy_avg}</Text>
              <Text style={styles.caption}>mg/dL on active days</Text>
              <Text style={styles.caption}>{effect.busy_steps?.toLocaleString()} steps</Text>
            </View>
          </View>
        ) : null}
        <Text style={styles.body}>{effect.text}</Text>
        {effect.status !== 'learning' ? <Text style={[styles.caption, { marginTop: 6 }]}>From {effect.days} of your own days. Meals and insulin differ between days too, so this is a hint, not proof.</Text> : null}
      </Card>

      {/* SLEEP, HEART, BODY */}
      <SectionHeader title="Sleep and body" />
      <Card style={{ paddingVertical: 8 }}>
        <VitalRow icon="moon-outline" title="Sleep" value={sleep ? minutesText(sleep.minutes) : '–'} note={sleep?.text ?? 'Add last night, or let your watch do it'} warn={sleep?.level === 'short'} onPress={() => onVital('sleep')} />
        <View style={styles.line} />
        <VitalRow
          icon="scale-outline"
          title="Weight"
          value={vitals.weight ? `${+vitals.weight.value.toFixed(1)} kg` : '–'}
          note={weightChange ? `${weightChange > 0 ? '+' : '−'}${Math.abs(weightChange).toFixed(1)} kg since ${new Date(weights[0].logged_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : vitals.weight ? timeAgo(vitals.weight.logged_at) ?? undefined : 'Updates your BMI too'}
          onPress={() => onVital('weight')}
        />
        <View style={styles.line} />
        <VitalRow
          icon="pulse-outline"
          title="Blood pressure"
          value={vitals.blood_pressure ? `${Math.round(vitals.blood_pressure.value)}/${Math.round(vitals.blood_pressure.value2 ?? 0)}` : '–'}
          note={vitals.blood_pressure?.text ?? 'From a cuff at home or the clinic'}
          warn={['high', 'urgent', 'low'].includes(vitals.blood_pressure?.level ?? '')}
          onPress={() => onVital('blood_pressure')}
        />
        <View style={styles.line} />
        <VitalRow
          icon="flask-outline"
          title="HbA1c"
          value={vitals.hba1c ? `${+vitals.hba1c.value.toFixed(1)}%` : '–'}
          note={vitals.hba1c ? `Lab test, ${new Date(vitals.hba1c.logged_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'From your lab report'}
          onPress={() => onVital('hba1c')}
        />
      </Card>
      <Card>
        <View style={styles.stats0}>
          <Stat icon="heart-outline" value={today.hr_resting != null ? String(today.hr_resting) : '–'} unit="bpm" label="resting" />
          <Stat icon="arrow-down" value={today.hr_min != null ? String(today.hr_min) : '–'} unit="bpm" label="lowest today" />
          <Stat icon="arrow-up" value={today.hr_max != null ? String(today.hr_max) : '–'} unit="bpm" label="highest today" />
        </View>
        <Button label="Check my stress" icon="mic-outline" size="md" variant="secondary" onPress={onVoice} style={{ marginTop: 14 }} />
      </Card>

      {/* JOURNAL */}
      <SectionHeader title="Journal" action="Add" onAction={onAdd} />
      <Card>
        {data.journal.length ? (
          data.journal.map((j, i) => (
            <View key={`${j.ended_at}${i}`} style={[styles.journal, i > 0 && styles.journalLine]}>
              <View style={styles.vitalIcon}>
                <Ionicons name={j.source === 'watch' ? 'watch-outline' : 'walk-outline'} size={21} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vitalTitle}>
                  {j.activity} · {j.minutes} min
                </Text>
                <Text style={styles.caption}>
                  {[
                    new Date(j.ended_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
                    j.steps ? `${j.steps.toLocaleString()} steps` : null,
                    j.distance_m ? `${(j.distance_m / 1000).toFixed(1)} km` : null,
                    j.kcal ? `${j.kcal} kcal` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {j.id != null ? (
                <Pressable onPress={() => onDelete(j.id as number, `${j.activity}, ${j.minutes} min`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${j.activity}, ${j.minutes} minutes`} style={styles.trash}>
                  <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.body}>Workouts and activities from the last 7 days will show here.</Text>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.lg, padding: 16, marginBottom: 14 },
  bannerTitle: { fontSize: 18, fontWeight: '800' },
  bannerText: { fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  legend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stats0: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 10, gap: 2 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.text, ...tabular },
  statUnit: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  caption: { fontSize: 13, lineHeight: 18, color: colors.textFaint },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  connect: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primaryPale, borderRadius: radius.md, padding: 13, marginTop: 12, minHeight: 48 },
  connectText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.primary },
  sitRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sitItem: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 10 },
  sitValue: { fontSize: 17, fontWeight: '800', color: colors.text, ...tabular },
  verdict: { fontSize: 21, fontWeight: '800', color: colors.text, marginBottom: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6, backgroundColor: colors.heart },
  progressText: { fontSize: 16, fontWeight: '800', color: colors.text, ...tabular },
  rangeRow: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 4, marginBottom: 12 },
  rangeBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  rangeOn: { backgroundColor: colors.card },
  rangeText: { fontSize: 15, fontWeight: '700', color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.text },
  compare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 12 },
  compareItem: { alignItems: 'center' },
  compareValue: { fontSize: 32, fontWeight: '800', color: colors.text, ...tabular },
  vital: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  vitalIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  vitalTitle: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  vitalValue: { fontSize: 17, fontWeight: '800', color: colors.text, ...tabular },
  line: { height: 1, backgroundColor: colors.divider },
  journal: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  journalLine: { borderTopWidth: 1, borderTopColor: colors.divider },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
