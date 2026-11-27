// components/FlowInputs.tsx
//
// The five inputs, with lines that run into the forecast below. A solid line
// with a moving dot is an input in use right now; its thickness is how much
// it moves the next hour. A dashed grey line is an input that isn't used.
// Tapping an input shows what it does to each result.

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { colors, radius, tabular } from '@/constants/theme';
import { haptic } from '@/lib/haptics';
import { curveAt, effectChip, INPUT_ICON, lineWidth, linkFor, OUTPUTS, SHORT_LABEL } from '@/lib/flow';
import type { InputKey, PlanInput, PlanLink } from '@/services/api';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const LINES = 72;
const STEPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

function Flow({ width, inputs, links, selected }: { width: number; inputs: PlanInput[]; links: PlanLink[]; selected: InputKey | null }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let gone = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce || gone) return;
        loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: false }));
        loop.start();
      });
    return () => {
      gone = true;
      loop?.stop();
    };
  }, [t]);

  const end = width / 2;
  return (
    <Svg width={width} height={LINES}>
      {inputs.map((input, i) => {
        const x = ((i + 0.5) * width) / inputs.length;
        const link = linkFor(links, input.key, 'forecast');
        const used = !!link?.used;
        const on = used && (!selected || selected === input.key);
        const w = lineWidth(input.effect);
        const points = STEPS.map((s) => curveAt(s, x, end, LINES - 6));
        return (
          <React.Fragment key={input.key}>
            <Path
              d={`M ${x} 2 C ${x} ${LINES * 0.55}, ${end} ${LINES * 0.35}, ${end} ${LINES - 6}`}
              stroke={used ? colors.primary : colors.textFaint}
              strokeOpacity={on ? 0.75 : used ? 0.25 : 0.35}
              strokeWidth={used ? w : 1.5}
              strokeDasharray={used ? undefined : '3 5'}
              strokeLinecap="round"
              fill="none"
            />
            {on ? (
              <AnimatedCircle
                r={4}
                fill={colors.primaryDark}
                cx={t.interpolate({ inputRange: STEPS, outputRange: points.map((p) => p.x) }) as any}
                cy={t.interpolate({ inputRange: STEPS, outputRange: points.map((p) => p.y) }) as any}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      <Path d={`M ${end - 8} ${LINES - 10} L ${end} ${LINES - 1} L ${end + 8} ${LINES - 10}`} stroke={colors.primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function FlowInputs({
  inputs,
  links,
  hideEffects = false,
  onAction,
}: {
  inputs: PlanInput[];
  links: PlanLink[];
  /** When a low is likely, single effects would reassure (assumesTreatment). */
  hideEffects?: boolean;
  onAction: (key: InputKey) => void;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<InputKey | null>(null);
  // Active insulin appears by itself, so it isn't one of the five to fill in.
  const toFill = inputs.filter((i) => i.key !== 'insulin');
  const ready = toFill.filter((i) => i.ready).length;
  const open = inputs.find((i) => i.key === selected);

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Your inputs
        </Text>
        <Text style={styles.count}>
          {ready} of {toFill.length} ready
        </Text>
      </View>

      <Text style={styles.hint}>Tap one to see what it changes.</Text>
      <View style={styles.row} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {inputs.map((i) => {
          const chip = hideEffects ? null : effectChip(i);
          const on = selected === i.key;
          return (
            <Pressable
              key={i.key}
              onPress={() => {
                haptic.tap();
                setSelected(on ? null : i.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: on }}
              accessibilityLabel={`${i.label}: ${i.value ?? 'missing'} ${i.value ? i.unit : ''}. ${chip ? `${chip} milligrams per decilitre in the next hour.` : ''} Show what it changes`}
              style={styles.node}
            >
              <View style={[styles.circle, inputs.length > 5 && styles.circleSmall, i.ready ? styles.circleReady : styles.circleMissing, on && styles.circleOn]}>
                <Ionicons name={INPUT_ICON[i.key]} size={22} color={on ? '#fff' : i.ready ? colors.primary : colors.textFaint} />
                {!i.ready ? (
                  <View style={styles.plus}>
                    <Ionicons name="add" size={13} color="#fff" />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.value, !i.ready && { color: colors.textFaint }]} numberOfLines={1} adjustsFontSizeToFit>
                {i.value ?? 'Add'}
              </Text>
              <Text style={styles.label} numberOfLines={1}>
                {SHORT_LABEL[i.key]}
              </Text>
              <Text style={styles.effect} numberOfLines={1}>
                {chip ?? ' '}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {open ? (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          <Text style={styles.panelTitle}>
            {open.label}
            {open.value ? `: ${open.value} ${open.unit}` : ''}
          </Text>
          <Text style={styles.panelNote}>
            {open.note}
            {open.kcal_today ? ` · ${open.kcal_today.toLocaleString()} kcal eaten today` : ''}
          </Text>
          {OUTPUTS.map((o) => {
            const link = linkFor(links, open.key, o.key);
            if (!link) return null;
            return (
              <View key={o.key} style={styles.linkRow}>
                <Ionicons name={link.used ? 'checkmark-circle' : 'remove-circle-outline'} size={19} color={link.used ? colors.primary : colors.textFaint} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTo}>{o.title}</Text>
                  <Text style={styles.linkText}>{link.text}</Text>
                </View>
              </View>
            );
          })}
          <Button label={ACTION[open.key]} size="md" variant="secondary" onPress={() => onAction(open.key)} style={{ marginTop: 12 }} />
        </View>
      ) : null}

      {width > 0 ? <Flow width={width} inputs={inputs} links={links} selected={selected} /> : <View style={{ height: LINES }} />}
    </View>
  );
}

const ACTION: Record<InputKey, string> = {
  sugar: 'Log blood sugar',
  food: 'Scan a meal',
  stress: 'Check my stress',
  activity: 'Add activity',
  body: 'Edit body details',
  insulin: 'Open bolus calculator',
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  count: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  row: { flexDirection: 'row' },
  node: { flex: 1, alignItems: 'center', minHeight: 48 },
  circle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 6, borderWidth: 2 },
  circleSmall: { width: 46, height: 46, borderRadius: 23 },
  circleReady: { backgroundColor: colors.card, borderColor: colors.primary },
  circleMissing: { backgroundColor: colors.surfaceMuted, borderColor: colors.textFaint, borderStyle: 'dashed' },
  circleOn: { backgroundColor: colors.primary, borderColor: colors.primary, borderStyle: 'solid' },
  plus: { position: 'absolute', right: -3, bottom: -2, width: 19, height: 19, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  value: { fontSize: 16, fontWeight: '800', color: colors.text, paddingHorizontal: 2, ...tabular },
  label: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  effect: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 3, ...tabular },
  hint: { fontSize: 13, color: colors.textFaint, marginTop: 2, marginBottom: 12 },
  panel: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 10 },
  panelTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  panelNote: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  linkRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' },
  linkTo: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  linkText: { fontSize: 14.5, lineHeight: 20, color: colors.textMuted },
});
