// components/fitness/ActivityRings.tsx
//
// Two rings for today: steps (outer) and Heart Points (inner), with the
// numbers in the middle. A full ring is the goal; past it, it stays full.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { colors, tabular } from '@/constants/theme';

const SIZE = 216;
const STROKE = 15;
const GAP = 5;

export function ActivityRings({ steps, stepGoal, points, pointGoal }: { steps: number | null; stepGoal: number; points: number | null; pointGoal: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = anim.addListener(({ value }) => setP(value));
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => !finished && setP(1));
    return () => anim.removeListener(id);
  }, [steps, points, stepGoal, pointGoal, anim]);

  const c = SIZE / 2;
  const ring = (r: number, share: number, color: string) => {
    const C = 2 * Math.PI * r;
    const filled = Math.max(0, Math.min(1, share)) * p;
    return (
      <G transform={`rotate(-90 ${c} ${c})`}>
        <Circle cx={c} cy={c} r={r} stroke={color} strokeOpacity={0.14} strokeWidth={STROKE} fill="none" />
        {filled > 0.004 ? <Circle cx={c} cy={c} r={r} stroke={color} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={`${C * filled} ${C}`} /> : null}
      </G>
    );
  };
  const outer = c - STROKE / 2 - 2;

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`${steps ?? 'No'} steps of ${stepGoal}. ${points ?? 0} Heart Points of ${pointGoal} today`}
    >
      <Svg width={SIZE} height={SIZE}>
        {ring(outer, (steps ?? 0) / stepGoal, colors.primary)}
        {ring(outer - STROKE - GAP, (points ?? 0) / pointGoal, colors.heart)}
      </Svg>
      <View style={styles.center}>
        <Ionicons name="footsteps-outline" size={18} color={colors.primary} />
        <Text style={styles.steps} numberOfLines={1} adjustsFontSizeToFit>
          {steps != null ? Math.round(steps * p).toLocaleString() : '–'}
        </Text>
        <Text style={styles.goal}>of {stepGoal.toLocaleString()}</Text>
        <View style={styles.pointsRow}>
          <Ionicons name="heart-outline" size={17} color={colors.heart} />
          <Text style={styles.points}>{points != null ? Math.round(points * p) : '–'}</Text>
          <Text style={styles.goal}>of {pointGoal}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', width: 118 },
  steps: { fontSize: 32, fontWeight: '800', color: colors.text, letterSpacing: -0.8, ...tabular },
  goal: { fontSize: 13, color: colors.textMuted, ...tabular },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  points: { fontSize: 18, fontWeight: '800', color: colors.text, ...tabular },
});
