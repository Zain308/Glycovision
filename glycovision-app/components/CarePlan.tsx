// components/CarePlan.tsx
//
// The connected plan on Home: the inputs run into 1) sugar in the next 60
// minutes, which runs into 2) insulin (only for people prescribed it) and
// 3) activity, and ends with when to check again. Between two steps, chips
// show which inputs shaped the next one. Everything is decided by the
// backend (services/care_plan.py); this only shows it.

import React, { useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ResearchNote } from '@/components/ui/ResearchNote';
import { FlowInputs } from '@/components/FlowInputs';
import { FORECAST_HEIGHT, ForecastChart, type PlannedBars } from '@/components/ForecastChart';
import { Waterfall } from '@/components/Waterfall';
import { colors, radius, tabular } from '@/constants/theme';
import { changeLabel, confidence, crossingText } from '@/lib/forecast';
import { assumesTreatment, clockAfter, INPUT_ICON } from '@/lib/flow';
import { haptic } from '@/lib/haptics';
import type { ActivityPlan, CarePlan as Plan, DoseTest, Forecast, InputKey, InsulinPlan, OutputKey, PlanEvent, PlanLink } from '@/services/api';

const SVG_FONT = 'PlusJakartaSans_600SemiBold';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ALERT: Record<NonNullable<Forecast['alert']>, { bg: string; fg: string; icon: IconName; solid: boolean }> = {
  urgent: { bg: colors.danger, fg: '#FFFFFF', icon: 'warning', solid: true },
  high: { bg: '#B85E06', fg: '#FFFFFF', icon: 'trending-up', solid: true },
  watch: { bg: colors.warningSoft, fg: colors.warningText, icon: 'eye-outline', solid: false },
  calm: { bg: colors.successSoft, fg: colors.successText, icon: 'checkmark-circle', solid: false },
};

function StepTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle} accessibilityRole="header">
          {title}
        </Text>
        {sub ? <Text style={styles.caption}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------ connectors

const SOURCE: Record<string, { icon: IconName; label: string }> = {
  sugar: { icon: INPUT_ICON.sugar, label: 'Sugar' },
  food: { icon: INPUT_ICON.food, label: 'Food' },
  stress: { icon: INPUT_ICON.stress, label: 'Stress' },
  activity: { icon: INPUT_ICON.activity, label: 'Activity' },
  body: { icon: INPUT_ICON.body, label: 'Body' },
  forecast: { icon: 'trending-up-outline', label: 'Forecast' },
  insulin: { icon: 'eyedrop-outline', label: 'Insulin' },
};

/** The line between two steps: what the next step is based on. */
function Connector({ to, links }: { to: OutputKey; links: PlanLink[] }) {
  const [open, setOpen] = useState(false);
  const used = links.filter((l) => l.to === to && l.used);
  const unused = links.filter((l) => l.to === to && !l.used);
  if (!used.length) return <View style={styles.spine} />;
  return (
    <View style={styles.connector}>
      <View style={styles.spine} />
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Based on ${used.map((l) => SOURCE[l.from].label).join(', ')}. Show why`}
        style={styles.because}
      >
        <View style={styles.becauseRow}>
          <Text style={styles.becauseLabel}>Based on</Text>
          {used.map((l) => (
            <View key={l.from} style={styles.source}>
              <Ionicons name={SOURCE[l.from].icon} size={15} color={colors.primary} />
              <Text style={styles.sourceText}>{SOURCE[l.from].label}</Text>
            </View>
          ))}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textMuted} style={styles.becauseChevron} />
        {open
          ? [...used, ...unused].map((l) => (
              <View key={l.from} style={styles.whyRow}>
                <Ionicons name={SOURCE[l.from].icon} size={17} color={l.used ? colors.primary : colors.textFaint} />
                <Text style={[styles.whyText, !l.used && { color: colors.textFaint }]}>
                  <Text style={styles.whyName}>{SOURCE[l.from].label}. </Text>
                  {l.text}
                </Text>
              </View>
            ))
          : null}
      </Pressable>
      <View style={styles.spine} />
      <Ionicons name="caret-down" size={18} color={colors.primary} style={{ marginTop: -7, marginBottom: 2 }} />
    </View>
  );
}

const WHAT_IF = [0, 15, 30, 60, 90];

/** Try a meal before eating it. Nothing is saved. */
function WhatIf({ carbs, busy, onChange }: { carbs: number; busy: boolean; onChange: (carbs: number) => void }) {
  return (
    <View style={styles.whatIf}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.subhead0}>What if I eat…</Text>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <View style={styles.whatIfRow}>
        {WHAT_IF.map((g) => {
          const on = g === carbs;
          return (
            <Pressable
              key={g}
              disabled={busy}
              onPress={() => {
                haptic.tap();
                onChange(g);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={g ? `What if I eat ${g} grams of carbs` : 'Nothing more'}
              style={[styles.whatIfChip, on && styles.whatIfOn]}
            >
              <Text style={[styles.whatIfText, on && { color: '#fff' }]} numberOfLines={1} adjustsFontSizeToFit>
                {g ? `${g} g` : 'None'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {carbs ? <Text style={styles.caption}>A preview only: a meal of {carbs} g carbs eaten now. 1 roti is about 15 to 20 g.</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------ 1. forecast

export function ForecastCard({
  forecast,
  onLog,
  events = [],
  planned = {},
  whatIf,
}: {
  forecast: Forecast;
  onLog: () => void;
  events?: PlanEvent[];
  planned?: PlannedBars;
  whatIf?: React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  if (forecast.status !== 'ready' || !forecast.points) {
    return (
      <Card>
        <StepTitle n={1} title="Next 60 minutes" sub="Where your sugar is heading" />
        <Text style={styles.body}>{forecast.message}</Text>
        <Button label="Log blood sugar" icon="add-circle" size="md" onPress={onLog} style={{ marginTop: 14 }} />
      </Card>
    );
  }

  const look = ALERT[forecast.alert ?? 'calm'];
  const label = changeLabel(forecast);
  const trust = confidence(forecast.based_on);
  const rough = !!trust.hint && forecast.based_on !== 'fingerstick_1';
  const leaving = crossingText(forecast.points);
  const arrow: IconName = forecast.direction === 'up' ? 'arrow-up' : forecast.direction === 'down' ? 'arrow-down' : 'remove';
  const pct = (v?: number) => `${Math.round((v ?? 0) * 100)}%`;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View
        style={[styles.banner, { backgroundColor: look.bg }]}
        accessibilityLiveRegion={look.solid ? 'assertive' : 'none'}
        accessibilityRole={look.solid ? 'alert' : undefined}
      >
        <Ionicons name={look.icon} size={26} color={look.fg} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerTitle, { color: look.fg }]}>{forecast.title}</Text>
          <Text style={[styles.bannerText, { color: look.fg }]}>{forecast.message}</Text>
        </View>
      </View>

      <View style={{ padding: 18 }}>
        <StepTitle n={1} title="Next 60 minutes" sub={trust.label} />

        <View style={styles.bigRow}>
          <View>
            <View style={styles.changeRow}>
              <Ionicons name={arrow} size={30} color={colors.text} />
              <Text style={styles.change} numberOfLines={1} adjustsFontSizeToFit>
                {label.text}
              </Text>
            </View>
            <Text style={styles.caption}>{label.unit}</Text>
          </View>
          <View style={styles.rangeRow}>
            <Text style={styles.toValue}>
              {forecast.range_60?.[0]}–{forecast.range_60?.[1]}
            </Text>
            <Text style={styles.caption}>likely range in 1 hour</Text>
          </View>
        </View>

        <View onLayout={onLayout} style={{ minHeight: FORECAST_HEIGHT }}>
          <ForecastChart
            points={forecast.points}
            startAt={forecast.reading_at ?? new Date().toISOString()}
            width={width}
            history={forecast.history}
            events={events}
            planned={planned}
            endLabel={assumesTreatment(forecast) ? 'if you act' : undefined}
          />
        </View>

        {leaving ? (
          <View style={styles.leaving}>
            <Ionicons name="time-outline" size={18} color={colors.warningText} />
            <Text style={styles.leavingText}>{leaving}</Text>
          </View>
        ) : null}

        {assumesTreatment(forecast) ? (
          <View style={styles.hint}>
            <Text style={styles.body}>The line expects you to act, for example by eating something. If you don’t, your sugar can go lower.</Text>
          </View>
        ) : (
          <Waterfall forecast={forecast} />
        )}

        <View style={styles.chips}>
          <View style={styles.chip}>
            <Text style={styles.chipValue}>{pct(forecast.spike_probability)}</Text>
            <Text style={styles.caption}>chance of a spike</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipValue}>{pct(forecast.low_probability)}</Text>
            <Text style={styles.caption}>chance of a low</Text>
          </View>
        </View>

        {whatIf}

        {trust.hint ? (
          <View style={[styles.hint, rough && { backgroundColor: colors.warningSoft }]}>
            <Text style={[styles.body, rough && { color: colors.warningText }]}>{trust.hint}</Text>
            {rough ? <Button label="Log another reading" icon="add-circle" size="md" variant="secondary" onPress={onLog} style={{ marginTop: 10 }} /> : null}
          </View>
        ) : null}

        <ResearchNote
          label="How exact is this?"
          details={`In tests on people the model had never seen, the 60-minute estimate was off by about ${forecast.typical_error_60} mg/dL on average, and the shaded range held the real value about ${Math.round((forecast.range_coverage ?? 0.8) * 10)} times in 10. ${forecast.disclaimer ?? ''}`}
        />
      </View>
    </Card>
  );
}

// ------------------------------------------------------------ 2. insulin

function DosePaths({ test }: { test: DoseTest }) {
  const [width, setWidth] = useState(0);
  const H = 130;
  const all = [...test.path_without, ...test.path_with].map((p) => p.bg);
  const top = Math.min(600, Math.max(200, ...all) + 15);
  const low = Math.min(60, ...all) - 5;
  const end = test.path_with[test.path_with.length - 1]?.minute || 240;
  const x = (m: number) => 30 + (m / end) * Math.max(0, width - 40);
  const y = (v: number) => 8 + (1 - (Math.max(low, Math.min(top, v)) - low) / (top - low)) * (H - 32);
  const path = (pts: DoseTest['path_with']) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.minute)} ${y(p.bg)}`).join(' ');
  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ minHeight: H }}>
      {width > 0 ? (
        <Svg width={width} height={H} accessibilityLabel={`Without insulin up to ${test.peak_without}. With this dose up to ${test.peak_with}, ending near ${test.end_with}.`}>
          <Rect x={30} y={y(180)} width={width - 40} height={y(70) - y(180)} fill={colors.successSoft} />
          <Line x1={30} x2={width - 10} y1={y(70)} y2={y(70)} stroke={colors.danger} strokeOpacity={0.4} strokeDasharray="3 4" />
          <Path d={path(test.path_without)} stroke={colors.warning} strokeWidth={2.5} strokeDasharray="5 5" fill="none" />
          <Path d={path(test.path_with)} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" />
          {[70, 180].map((v) => (
            <SvgText key={v} x={24} y={y(v) + 4} fontSize="11" fontFamily={SVG_FONT} fill={colors.textFaint} textAnchor="end">
              {v}
            </SvgText>
          ))}
          <SvgText x={30} y={H - 6} fontSize="11" fontFamily={SVG_FONT} fill={colors.textFaint}>
            Now
          </SvgText>
          <SvgText x={width - 10} y={H - 6} fontSize="11" fontFamily={SVG_FONT} fill={colors.textFaint} textAnchor="end">
            {`${test.hours} h`}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

export function InsulinCard({ plan, preview = false, onProfile, onBolus, onLog }: { plan: InsulinPlan; preview?: boolean; onProfile: () => void; onBolus: () => void; onLog: () => void }) {
  if (plan.status === 'not_needed') return null;
  const dose = plan.status === 'dose';
  return (
    <Card>
      <StepTitle n={2} title="Insulin" sub={preview && plan.carbs ? `If you eat ${plan.carbs} g carbs now` : plan.meal_name ? `For ${plan.meal_name}, ${plan.carbs} g carbs` : undefined} />
      {dose ? (
        <>
          <View style={styles.doseRow}>
            <Text style={styles.dose}>{plan.units}</Text>
            <Text style={styles.doseUnit}>{preview ? 'units, preview only' : 'units suggested'}</Text>
          </View>
          <View style={styles.timing}>
            <View style={styles.timingItem}>
              <Text style={styles.timingValue}>{plan.starts}</Text>
              <Text style={styles.caption}>starts working</Text>
            </View>
            <View style={styles.timingItem}>
              <Text style={styles.timingValue}>{plan.strongest}</Text>
              <Text style={styles.caption}>strongest</Text>
            </View>
            <View style={styles.timingItem}>
              <Text style={styles.timingValue}>{plan.dia_hours} hours</Text>
              <Text style={styles.caption}>lasts about</Text>
            </View>
          </View>
        </>
      ) : null}

      {plan.test && (dose || plan.status === 'none_needed') && plan.test.peak_without > plan.test.peak_with + 5 ? (
        <>
          <Text style={styles.subhead}>Tested on your insulin curve</Text>
          <DosePaths test={plan.test} />
          <View style={styles.legendRow}>
            <View style={[styles.legendLine, { borderColor: colors.warning, borderStyle: 'dashed' }]} />
            <Text style={styles.caption}>No insulin: up to {plan.test.peak_without} (textbook estimate)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendLine, { borderColor: colors.primary }]} />
            <Text style={styles.caption}>
              With {plan.test.units} u: up to {plan.test.peak_with}, ending near {plan.test.end_with}
            </Text>
          </View>
        </>
      ) : null}

      {!dose || plan.test?.lowered ? <Text style={[styles.body, { marginTop: 8 }]}>{plan.message}</Text> : null}
      {plan.iob ? <Text style={styles.caption}>Active insulin counted: {plan.iob} u</Text> : null}
      {plan.weight_check ? (
        <View style={styles.leaving}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warningText} />
          <Text style={styles.leavingText}>{plan.weight_check}</Text>
        </View>
      ) : null}

      {plan.status === 'setup' ? <Button label="Finish in Profile" icon="person-outline" size="md" variant="secondary" onPress={onProfile} style={{ marginTop: 12 }} /> : null}
      {plan.status === 'need_reading' ? <Button label="Log blood sugar" icon="add-circle" size="md" onPress={onLog} style={{ marginTop: 12 }} /> : null}
      {dose && !preview ? <Button label="Review and confirm" icon="calculator-outline" size="md" onPress={onBolus} style={{ marginTop: 14 }} /> : null}
      {dose ? (
        <ResearchNote
          label="Estimate only, not a prescription"
          details="The units come from your own ratios, not from AI. The curve assumes rapid-acting insulin, steady background insulin, and carbs absorbed over 3 hours. Stress, illness and exercise are not included. Check with your doctor's plan before you inject."
        />
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------ 3. activity

const OPTION_ICON: Record<string, IconName> = {
  walk_easy: 'walk-outline',
  walk_brisk: 'walk-outline',
  stretch: 'body-outline',
  move_break: 'swap-vertical-outline',
  chair: 'fitness-outline',
  breathe: 'leaf-outline',
};

export function ActivityCard({ plan, step, onLog, onActivity }: { plan: ActivityPlan; step: number; onLog: () => void; onActivity: () => void }) {
  const blocked = plan.status === 'blocked';
  return (
    <Card>
      <StepTitle n={step} title="Activity" sub={plan.headline} />
      <Text style={styles.body}>{plan.why}</Text>

      {plan.options.map((o) => (
        <View key={o.key} style={styles.option}>
          <View style={styles.optionIcon}>
            <Ionicons name={OPTION_ICON[o.key] ?? 'walk-outline'} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>
              {o.name} · {o.minutes} min
            </Text>
            <Text style={styles.caption}>{o.why}</Text>
          </View>
          {o.kcal ? <Text style={styles.kcal}>{o.kcal} kcal</Text> : null}
        </View>
      ))}

      {plan.safety.length ? (
        <View style={[styles.safety, plan.status === 'caution' && { backgroundColor: colors.warningSoft }]}>
          {plan.safety.map((s) => (
            <View key={s} style={styles.safetyRow}>
              <Ionicons name="shield-checkmark-outline" size={17} color={plan.status === 'caution' ? colors.warningText : colors.textMuted} />
              <Text style={[styles.safetyText, plan.status === 'caution' && { color: colors.warningText }]}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {plan.status === 'need_reading' || blocked ? (
        <Button label="Log blood sugar" icon="add-circle" size="md" onPress={onLog} style={{ marginTop: 12 }} />
      ) : (
        <Button label="I did an activity" icon="checkmark-circle-outline" size="md" variant="secondary" onPress={onActivity} style={{ marginTop: 12 }} />
      )}
    </Card>
  );
}

// ------------------------------------------------------------ all together

function Recheck({ minutes, stress, onLog, onRemind }: { minutes: number; stress: string | null | undefined; onLog: () => void; onRemind: () => void }) {
  return (
    <View style={styles.recheck}>
      <View style={styles.recheckIcon}>
        <Ionicons name="refresh" size={22} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.recheckTitle}>{minutes ? `Check again at ${clockAfter(minutes)}` : 'Log your sugar to start'}</Text>
        <Text style={styles.recheckText}>
          {minutes
            ? `Your new reading updates every step${stress === 'elevated' ? '. Sooner than usual because of stress' : ''}.`
            : 'Every step below your inputs needs a reading from the last 15 minutes.'}
        </Text>
      </View>
      <Pressable
        onPress={minutes ? onRemind : onLog}
        accessibilityRole="button"
        accessibilityLabel={minutes ? 'Set a reminder' : 'Log blood sugar'}
        style={styles.recheckBtn}
      >
        <Ionicons name={minutes ? 'alarm-outline' : 'add'} size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

export function CarePlanSection({
  plan,
  carbs = 0,
  busy = false,
  onWhatIf,
  onInput,
  onLog,
  onProfile,
  onBolus,
  onActivity,
  onRemind,
}: {
  plan: Plan;
  /** Preview meal in grams; 0 = the real plan. */
  carbs?: number;
  busy?: boolean;
  onWhatIf: (carbs: number) => void;
  onInput: (key: InputKey) => void;
  onLog: () => void;
  onProfile: () => void;
  onBolus: () => void;
  onActivity: () => void;
  onRemind: (minutes: number) => void;
}) {
  const insulin = plan.insulin.status !== 'not_needed';
  const first = plan.activity.status === 'go' || plan.activity.status === 'caution' ? plan.activity.options.find((o) => o.key !== 'breathe') : undefined;
  const planned: PlannedBars = {
    insulin: plan.insulin.status === 'dose' && plan.insulin.units ? { units: plan.insulin.units } : undefined,
    activity: first ? { label: `${first.minutes} min`, minutes: first.minutes } : undefined,
  };
  const ready = plan.forecast.status === 'ready';
  return (
    <View style={busy ? { opacity: 0.7 } : undefined}>
      <FlowInputs inputs={plan.inputs} links={plan.links} hideEffects={assumesTreatment(plan.forecast)} onAction={onInput} />
      <ForecastCard
        forecast={plan.forecast}
        onLog={onLog}
        events={plan.events}
        planned={planned}
        whatIf={ready ? <WhatIf carbs={carbs} busy={busy} onChange={onWhatIf} /> : null}
      />
      {insulin ? (
        <>
          <Connector to="insulin" links={plan.links} />
          <InsulinCard plan={plan.insulin} preview={carbs > 0} onProfile={onProfile} onBolus={onBolus} onLog={onLog} />
        </>
      ) : null}
      <Connector to="move" links={plan.links} />
      <ActivityCard plan={plan.activity} step={insulin ? 3 : 2} onLog={onLog} onActivity={onActivity} />
      {plan.recheck_minutes != null ? (
        <>
          <View style={styles.connector}>
            <View style={styles.spine} />
            <Ionicons name="caret-down" size={18} color={colors.primary} style={{ marginTop: -7, marginBottom: 2 }} />
          </View>
          <Recheck minutes={plan.recheck_minutes} stress={plan.stress?.level} onLog={onLog} onRemind={() => onRemind(plan.recheck_minutes ?? 0)} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  connector: { alignItems: 'center' },
  spine: { width: 3, height: 18, backgroundColor: colors.primary, opacity: 0.75, alignSelf: 'center' },
  because: { alignSelf: 'stretch', backgroundColor: colors.primaryPale, borderWidth: 1, borderColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 30, paddingVertical: 10, minHeight: 48, justifyContent: 'center' },
  becauseRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  becauseChevron: { position: 'absolute', right: 9, top: 15 },
  becauseLabel: { fontSize: 14, color: colors.textMuted },
  source: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  sourceText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  whyRow: { flexDirection: 'row', gap: 9, marginTop: 10, marginHorizontal: -16, alignItems: 'flex-start' },
  whyText: { flex: 1, fontSize: 14.5, lineHeight: 20, color: colors.textMuted },
  whyName: { fontWeight: '800', color: colors.text },
  whatIf: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: 16, paddingTop: 14, gap: 10 },
  subhead0: { fontSize: 15, fontWeight: '800', color: colors.text },
  whatIfRow: { flexDirection: 'row', gap: 6 },
  whatIfChip: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  whatIfOn: { backgroundColor: colors.primary },
  whatIfText: { fontSize: 15, fontWeight: '700', color: colors.text, ...tabular },
  recheck: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  recheckIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  recheckTitle: { fontSize: 16.5, fontWeight: '800', color: colors.text },
  recheckText: { fontSize: 14, lineHeight: 19, color: colors.textMuted, marginTop: 1 },
  recheckBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 16 },
  bannerTitle: { fontSize: 18, fontWeight: '800' },
  bannerText: { fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 15, fontWeight: '800', color: colors.primary },
  stepTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  subhead: { fontSize: 14.5, fontWeight: '700', color: colors.textMuted, marginTop: 14, marginBottom: 6 },
  body: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  caption: { fontSize: 13, lineHeight: 18, color: colors.textFaint },
  bigRow: { gap: 8, marginBottom: 4 },
  rangeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  change: { flexShrink: 1, fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: -0.8, ...tabular },
  toValue: { fontSize: 21, fontWeight: '800', color: colors.text, ...tabular },
  leaving: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: 12, marginTop: 8 },
  leavingText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.warningText },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 10 },
  chipValue: { fontSize: 18, fontWeight: '800', color: colors.text, ...tabular },
  hint: { backgroundColor: colors.primaryPale, borderRadius: radius.md, padding: 14, marginTop: 12 },
  doseRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dose: { fontSize: 48, fontWeight: '800', color: colors.text, letterSpacing: -1.2, ...tabular },
  doseUnit: { fontSize: 16, fontWeight: '700', color: colors.textMuted },
  timing: { flexDirection: 'row', gap: 8, marginTop: 10 },
  timingItem: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 10 },
  timingValue: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  legendLine: { width: 22, height: 0, borderTopWidth: 3 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  optionIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  kcal: { fontSize: 14, fontWeight: '700', color: colors.textMuted, ...tabular },
  safety: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 12, marginTop: 14, gap: 8 },
  safetyRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  safetyText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
