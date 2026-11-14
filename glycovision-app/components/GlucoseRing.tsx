// components/GlucoseRing.tsx
//
// Gauge for the latest blood sugar: a 270° ring on a 40-300 mg/dL scale.
// The green arc marks the 70-180 target; the coloured arc fills up to the
// reading (animated) and ends in a knob. The number sits in the middle.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { Text } from '@/components/ui/Typography';
import { toneColors } from '@/components/ui/Bits';
import { colors, tabular } from '@/constants/theme';
import { glucoseStatus, RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';

const MIN = 40;
const MAX = 300;
const SWEEP = 270;
const START = 135; // degrees, bottom-left

const frac = (v: number) => Math.max(0, Math.min(1, (v - MIN) / (MAX - MIN)));

export function GlucoseRing({ value, size = 210 }: { value: number | null; size?: number }) {
  const stroke = 16;
  const r = (size - stroke) / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const ARC = (SWEEP / 360) * C;

  const status = glucoseStatus(value);
  const color = status ? toneColors[status.tone].strong : colors.border;

  // Animate 0 -> reading.
  const anim = useRef(new Animated.Value(0)).current;
  const [p, setP] = useState(0);
  useEffect(() => {
    if (value == null) return;
    const id = anim.addListener(({ value: x }) => setP(x));
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: frac(value),
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [value, anim]);

  const shownValue = value == null ? null : Math.round(MIN + p * (MAX - MIN));
  const angle = ((START + SWEEP * p) * Math.PI) / 180;
  const kx = cx + r * Math.cos(angle);
  const ky = cy + r * Math.sin(angle);
  const lo = frac(RANGE_LOW);
  const hi = frac(RANGE_HIGH);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <G transform={`rotate(${START} ${cx} ${cy})`}>
          {/* Track */}
          <Circle cx={cx} cy={cy} r={r} stroke="#DFE7F3" strokeWidth={stroke} fill="none" strokeDasharray={`${ARC} ${C}`} strokeLinecap="round" />
          {/* Target range 70-180 */}
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="#BFEBD8"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${ARC * (hi - lo)} ${C}`}
            strokeDashoffset={-ARC * lo}
          />
          {/* Reading */}
          {value != null && p > 0.001 ? (
            <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={stroke - 6} fill="none" strokeDasharray={`${ARC * p} ${C}`} strokeLinecap="round" />
          ) : null}
        </G>
        {value != null ? (
          <>
            <Circle cx={kx} cy={ky} r={11} fill={colors.card} />
            <Circle cx={kx} cy={ky} r={7} fill={color} />
          </>
        ) : null}
      </Svg>

      <View style={{ alignItems: 'center' }}>
        <Text style={styles.value}>{shownValue ?? '—'}</Text>
        <Text style={styles.unit}>mg/dL</Text>
      </View>
      <View style={[styles.scale, { width: size * 0.62 }]}>
        <Text style={styles.scaleText}>{MIN}</Text>
        <Text style={styles.scaleText}>{MAX}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  value: { fontSize: 54, fontWeight: '800', color: colors.text, letterSpacing: -2, ...tabular },
  unit: { fontSize: 14, fontWeight: '600', color: colors.textMuted, marginTop: -4 },
  scale: { position: 'absolute', bottom: 6, flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { fontSize: 12, fontWeight: '600', color: colors.textFaint },
});
