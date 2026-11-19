// components/GlucoseChart.tsx
//
// 24-hour blood sugar chart that stays honest with finger-prick data:
//
// * Fixed time axis (24 h ago -> now) with 6-hour gridlines, so the
//   spacing between readings matches the real time between them.
// * Low / target / high zones in the background.
// * One dot per reading, coloured by status (low, in range, high).
// * Readings less than 3 h apart are joined by a smooth line that never
//   overshoots the real values. Longer gaps get a faint dashed line,
//   meaning "no readings here", instead of a made-up curve.
// * The latest reading is labelled; tap anywhere to see the nearest one.

import React, { useEffect, useId, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Line, Path, Rect, Stop, Text as SvgText, Circle } from 'react-native-svg';

import { Text } from '@/components/ui/Typography';
import { IconBadge, toneColors } from '@/components/ui/Bits';
import { colors } from '@/constants/theme';
import { glucoseStatus, RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';
import type { BgReading } from '@/services/api';

export const CHART_HEIGHT = 210;
const PAD_LEFT = 34;
const PAD_RIGHT = 16;
const PAD_TOP = 28; // room for the value label above the latest dot
const PAD_BOTTOM = 26;
const MIN_BG = 40;
const WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_GAP_MS = 3 * 60 * 60 * 1000;
const FONT = { fontFamily: 'PlusJakartaSans_600SemiBold' };
const BOLD = { fontFamily: 'PlusJakartaSans_700Bold' };

type Pt = { x: number; y: number };

const scaleTop = (values: number[]) =>
  Math.min(400, Math.max(240, Math.ceil((Math.max(...values) + 30) / 20) * 20));

/** Split time-sorted readings into runs with no gap longer than MAX_GAP_MS. */
export function splitIntoRuns<T extends { t: number }>(items: T[], maxGap = MAX_GAP_MS): T[][] {
  const runs: T[][] = [];
  for (const it of items) {
    const run = runs[runs.length - 1];
    if (run && it.t - run[run.length - 1].t <= maxGap) run.push(it);
    else runs.push([it]);
  }
  return runs;
}

// Monotone cubic (Fritsch-Carlson): smooth, but never bends above or below
// the real readings, so the line can't invent a peak or a dip.
function monotonePath(pts: Pt[]) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    m.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1e-6));
  }
  const tan: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / m[i];
    const b = tan[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tan[i] = k * a * m[i];
      tan[i + 1] = k * b * m[i];
    }
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${pts[i].x + h} ${pts[i].y + tan[i] * h}, ${pts[i + 1].x - h} ${pts[i + 1].y - tan[i + 1] * h}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtHour = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric' });

export function GlucoseChart({ readings, width }: { readings: BgReading[]; width: number }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const areaId = `gvArea${uid}`;
  const clipId = `gvReveal${uid}`;

  useEffect(() => {
    setSelected(null);
    if (!readings.length || width <= 0) return;
    const id = reveal.addListener(({ value }) => setW(value));
    reveal.setValue(0);
    Animated.timing(reveal, { toValue: width, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(
      ({ finished }) => {
        if (!finished) setW(width);
      },
    );
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      reveal.removeListener(id);
      loop.stop();
    };
  }, [readings, width, reveal, pulse]);

  const valid = readings
    .map((r) => ({ ...r, t: new Date(r.logged_at).getTime() }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.value) && r.value > 0)
    .sort((a, b) => a.t - b.t);

  if (!valid.length) {
    return (
      <View style={styles.empty}>
        <IconBadge icon="pulse-outline" tone="brand" size={52} />
        <Text style={styles.emptyTitle}>No readings yet</Text>
        <Text style={styles.emptySub}>Log your blood sugar a few times today to see your pattern here.</Text>
      </View>
    );
  }
  if (width <= 0) return <View style={{ height: CHART_HEIGHT }} />;

  const now = Math.max(Date.now(), valid[valid.length - 1].t);
  const start = now - WINDOW_MS;
  const pts = valid.filter((r) => r.t >= start);
  const shown = pts.length ? pts : [valid[valid.length - 1]];

  const drawW = width - PAD_LEFT - PAD_RIGHT;
  const drawH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const bottom = PAD_TOP + drawH;
  const top = scaleTop(shown.map((r) => r.value));
  const x = (t: number) => PAD_LEFT + Math.max(0, Math.min(1, (t - start) / WINDOW_MS)) * drawW;
  const y = (v: number) => PAD_TOP + drawH - ((Math.max(MIN_BG, Math.min(top, v)) - MIN_BG) / (top - MIN_BG)) * drawH;

  const items = shown.map((r) => ({ ...r, x: x(r.t), y: y(r.value) }));
  const runs = splitIntoRuns(items);
  const gaps = runs.slice(1).map((run, i) => {
    const prev = runs[i][runs[i].length - 1];
    return { from: prev, to: run[0] };
  });

  const hiY = y(RANGE_HIGH);
  const loY = y(RANGE_LOW);
  const toneOf = (v: number) => toneColors[glucoseStatus(v)?.tone ?? 'brand'].strong;

  const last = items[items.length - 1];
  const lastColor = toneOf(last.value);
  const done = w >= width - 1;

  // Gridlines every 6 hours on the clock (12 AM, 6 AM, 12 PM, 6 PM).
  const ticks: number[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  while (first.getTime() <= start || first.getHours() % 6 !== 0) first.setHours(first.getHours() + 1);
  for (let t = first.getTime(); t < now - 60 * 60 * 1000; t += 6 * 60 * 60 * 1000) ticks.push(t);

  const sel = selected != null ? items[selected] : null;

  const onPress = (e: GestureResponderEvent) => {
    const px = e.nativeEvent.locationX;
    let best = 0;
    items.forEach((it, i) => {
      if (Math.abs(it.x - px) < Math.abs(items[best].x - px)) best = i;
    });
    setSelected(Math.abs(items[best].x - px) < 40 ? (best === selected ? null : best) : null);
  };

  // Value bubble: above the dot, kept inside the chart.
  const bubble = (it: (typeof items)[number], label: string, color: string) => {
    const bw = Math.max(44, label.length * 7.4 + 16);
    const bx = Math.min(Math.max(it.x - bw / 2, PAD_LEFT - 6), width - bw - 2);
    const by = Math.max(2, it.y - 34);
    return (
      <G>
        <Rect x={bx} y={by} width={bw} height={22} rx={11} fill={color} />
        <SvgText x={bx + bw / 2} y={by + 15} fontSize="12" fill="#fff" textAnchor="middle" {...BOLD}>
          {label}
        </SvgText>
      </G>
    );
  };

  return (
    <Pressable onPress={onPress} accessibilityRole="image" accessibilityLabel={`Blood sugar over the last 24 hours, ${items.length} readings, latest ${last.value} mg/dL`}>
      <Svg width={width} height={CHART_HEIGHT}>
        <Defs>
          <LinearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={0.16} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
          </LinearGradient>
          <ClipPath id={clipId}>
            <Rect x={0} y={0} width={w} height={CHART_HEIGHT} />
          </ClipPath>
        </Defs>

        {/* Zones: high, target, low */}
        <Rect x={PAD_LEFT} y={PAD_TOP} width={drawW} height={Math.max(0, hiY - PAD_TOP)} fill={colors.warningSoft} opacity={0.55} />
        <Rect x={PAD_LEFT} y={hiY} width={drawW} height={loY - hiY} fill={colors.successSoft} />
        <Rect x={PAD_LEFT} y={loY} width={drawW} height={Math.max(0, bottom - loY)} fill={colors.dangerSoft} opacity={0.7} />

        {/* Time gridlines */}
        {ticks.map((t) => (
          <G key={t}>
            <Line x1={x(t)} y1={PAD_TOP} x2={x(t)} y2={bottom} stroke={colors.border} strokeWidth={1} />
            <SvgText x={x(t)} y={CHART_HEIGHT - 8} fontSize="11" fill={colors.textFaint} textAnchor="middle" {...FONT}>
              {fmtHour(t)}
            </SvgText>
          </G>
        ))}
        <SvgText x={PAD_LEFT + drawW} y={CHART_HEIGHT - 8} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
          Now
        </SvgText>

        {/* Range labels */}
        <SvgText x={PAD_LEFT - 7} y={hiY + 4} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {RANGE_HIGH}
        </SvgText>
        <SvgText x={PAD_LEFT - 7} y={loY + 4} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {RANGE_LOW}
        </SvgText>

        <G clipPath={`url(#${clipId})`}>
          {/* Gaps with no readings: faint dashed */}
          {gaps.map(({ from, to }) => (
            <Line
              key={`gap${from.t}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={colors.textFaint}
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeDasharray="2 6"
              strokeLinecap="round"
            />
          ))}

          {/* Connected runs: soft fill + smooth line */}
          {runs.map((run) =>
            run.length > 1 ? (
              <G key={`run${run[0].t}`}>
                <Path
                  d={`${monotonePath(run)} L ${run[run.length - 1].x} ${bottom} L ${run[0].x} ${bottom} Z`}
                  fill={`url(#${areaId})`}
                />
                <Path d={monotonePath(run)} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </G>
            ) : null,
          )}

          {/* One dot per reading */}
          {items.map((it, i) => (
            <G key={`dot${it.t}${i}`}>
              <Circle cx={it.x} cy={it.y} r={i === items.length - 1 || i === selected ? 7 : 5.5} fill={colors.card} />
              <Circle cx={it.x} cy={it.y} r={i === items.length - 1 || i === selected ? 5 : 3.8} fill={toneOf(it.value)} />
            </G>
          ))}
        </G>

        {done && !sel ? bubble(last, `${Math.round(last.value)}`, lastColor) : null}
        {done && sel ? bubble(sel, `${Math.round(sel.value)} · ${fmtTime(sel.t)}`, toneOf(sel.value)) : null}
      </Svg>

      {/* Live halo on the latest reading */}
      {done ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              left: last.x - 14,
              top: last.y - 14,
              backgroundColor: lastColor,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }],
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 26, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 4 },
  emptySub: { fontSize: 14.5, color: colors.textMuted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 12 },
  halo: { position: 'absolute', width: 28, height: 28, borderRadius: 14 },
});
