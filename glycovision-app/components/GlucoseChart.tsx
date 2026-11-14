// components/GlucoseChart.tsx
//
// Smooth 24-hour blood sugar chart: curved line with a soft gradient
// fill, the 70-180 target band, and a pulsing dot on the latest reading.
// The line draws itself in from left to right.

import React, { useEffect, useId, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, LinearGradient, Line, Path, Rect, Stop, Text as SvgText, Circle } from 'react-native-svg';

import { Text } from '@/components/ui/Typography';
import { IconBadge, toneColors } from '@/components/ui/Bits';
import { colors } from '@/constants/theme';
import { glucoseStatus, RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';
import type { BgReading } from '@/services/api';

export const CHART_HEIGHT = 190;
const PAD_LEFT = 34;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const MIN_BG = 40;
const FONT = { fontFamily: 'PlusJakartaSans_600SemiBold' };

const scaleTop = (values: number[]) =>
  Math.min(400, Math.max(220, Math.ceil((Math.max(...values) + 30) / 20) * 20));

// Catmull-Rom spline through the points, as cubic Bézier segments.
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C ${p1.x + (p2.x - p0.x) * t} ${p1.y + (p2.y - p0.y) * t}, ${p2.x - (p3.x - p1.x) * t} ${p2.y - (p3.y - p1.y) * t}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function GlucoseChart({ readings, width }: { readings: BgReading[]; width: number }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const areaId = `gvArea${uid}`;
  const clipId = `gvReveal${uid}`;

  useEffect(() => {
    if (!readings.length || width <= 0) return;
    const id = reveal.addListener(({ value }) => setW(value));
    reveal.setValue(0);
    Animated.timing(reveal, { toValue: width, duration: 1200, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      reveal.removeListener(id);
      loop.stop();
    };
  }, [readings, width, reveal, pulse]);

  if (!readings.length) {
    return (
      <View style={styles.empty}>
        <IconBadge icon="pulse" tone="brand" size={52} />
        <Text style={styles.emptyTitle}>No readings yet</Text>
        <Text style={styles.emptySub}>Log your blood sugar a few times today to see your pattern here.</Text>
      </View>
    );
  }
  if (width <= 0) return <View style={{ height: CHART_HEIGHT }} />;

  const sorted = [...readings].sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());
  const drawW = width - PAD_LEFT - PAD_RIGHT;
  const drawH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const times = sorted.map((r) => new Date(r.logged_at).getTime());
  const minT = Math.min(...times);
  const span = Math.max(Math.max(...times) - minT, 1);
  const top = scaleTop(sorted.map((r) => r.value));
  const x = (t: number) => (sorted.length === 1 ? PAD_LEFT + drawW / 2 : PAD_LEFT + ((t - minT) / span) * drawW);
  const y = (v: number) => PAD_TOP + drawH - ((Math.max(MIN_BG, Math.min(top, v)) - MIN_BG) / (top - MIN_BG)) * drawH;

  const pts = sorted.map((r) => ({ x: x(new Date(r.logged_at).getTime()), y: y(r.value) }));
  const line = smoothPath(pts);
  const area = line ? `${line} L ${pts[pts.length - 1].x} ${PAD_TOP + drawH} L ${pts[0].x} ${PAD_TOP + drawH} Z` : '';
  const last = sorted[sorted.length - 1];
  const lp = pts[pts.length - 1];
  const lastColor = toneColors[glucoseStatus(last.value)?.tone ?? 'brand'].strong;
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const hiY = y(RANGE_HIGH);
  const loY = y(RANGE_LOW);

  return (
    <View>
      <Svg width={width} height={CHART_HEIGHT} accessibilityLabel="Blood sugar over the last 24 hours">
        <Defs>
          <LinearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={0.22} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
          </LinearGradient>
          <ClipPath id={clipId}>
            <Rect x={0} y={0} width={w} height={CHART_HEIGHT} />
          </ClipPath>
        </Defs>

        <Rect x={PAD_LEFT} y={hiY} width={drawW} height={loY - hiY} fill={colors.successSoft} rx={8} />
        <Line x1={PAD_LEFT} y1={hiY} x2={PAD_LEFT + drawW} y2={hiY} stroke={colors.success} strokeOpacity={0.35} strokeDasharray="3 5" />
        <Line x1={PAD_LEFT} y1={loY} x2={PAD_LEFT + drawW} y2={loY} stroke={colors.danger} strokeOpacity={0.35} strokeDasharray="3 5" />
        <SvgText x={PAD_LEFT - 8} y={hiY + 4} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {RANGE_HIGH}
        </SvgText>
        <SvgText x={PAD_LEFT - 8} y={loY + 4} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {RANGE_LOW}
        </SvgText>

        {area ? <Path d={area} fill={`url(#${areaId})`} clipPath={`url(#${clipId})`} /> : null}
        {line ? (
          <Path d={line} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clipId})`} />
        ) : null}
        {w >= width - 1 ? (
          <>
            <Circle cx={lp.x} cy={lp.y} r={8} fill={colors.card} />
            <Circle cx={lp.x} cy={lp.y} r={5.5} fill={lastColor} />
          </>
        ) : null}

        <SvgText x={PAD_LEFT} y={CHART_HEIGHT - 6} fontSize="11" fill={colors.textFaint} {...FONT}>
          {fmt(sorted[0].logged_at)}
        </SvgText>
        {sorted.length > 1 && (
          <SvgText x={PAD_LEFT + drawW} y={CHART_HEIGHT - 6} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
            {fmt(last.logged_at)}
          </SvgText>
        )}
      </Svg>

      {/* Live halo on the latest reading */}
      {w >= width - 1 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              left: lp.x - 14,
              top: lp.y - 14,
              backgroundColor: lastColor,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 26, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 4 },
  emptySub: { fontSize: 14.5, color: colors.textMuted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 12 },
  halo: { position: 'absolute', width: 28, height: 28, borderRadius: 14 },
});
