// components/ForecastChart.tsx
//
// The spike picture for the next 60 minutes. The hour ahead takes most of the
// width, and the scale follows the expected line, so a rise looks like a rise.
// On it:
//   * the expected line, coloured by zone, with the range 8 in 10 readings
//     should fall in;
//   * the part above 180 (or below 70) filled in: the spike itself;
//   * when it passes 180, and how high it goes and when (the peak);
//   * a risk strip: the chance of being above 180 (or below 70) at each moment.
// The last half hour of readings sits on the left; meals, insulin and activity
// sit under it on the same time axis.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import { RANGE_HIGH, RANGE_LOW } from '@/lib/glucose';
import { chanceAt, crossing, extreme, focusRange, riskKind } from '@/lib/forecast';
import { signed } from '@/lib/flow';
import type { ForecastPoint, PlanEvent } from '@/services/api';

const PLOT = 270;
const RISK = 40;
const LANE = 26;
const LANES = ['food', 'insulin', 'activity'] as const;
export const FORECAST_HEIGHT = PLOT + RISK + LANES.length * LANE + 8;
const PAD = { left: 66, right: 12, top: 40, bottom: 30 };
/** Share of the width for the past, when there is one. */
const PAST_SHARE = 0.22;
const LANE_LABEL = { food: 'Food', insulin: 'Insulin', activity: 'Move' };
const FONT = { fontFamily: 'PlusJakartaSans_600SemiBold' };
const BOLD = { fontFamily: 'PlusJakartaSans_700Bold' };

const zoneColor = (v: number) => (v < RANGE_LOW ? colors.danger : v > RANGE_HIGH ? colors.warning : colors.primary);

/** What the plan suggests, drawn ahead of now. */
export type PlannedBars = { insulin?: { units: number }; activity?: { label: string; minutes: number } };

export function ForecastChart({
  points,
  startAt,
  width,
  history = [],
  events = [],
  planned = {},
  endLabel,
}: {
  points: ForecastPoint[];
  startAt: string;
  width: number;
  history?: { minute: number; bg: number }[];
  events?: PlanEvent[];
  planned?: PlannedBars;
  /** Replaces "about 155" at the end of the line. */
  endLabel?: string;
}) {
  const reveal = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    setPicked(null);
    if (width <= 0) return;
    const id = reveal.addListener(({ value }) => setShown(value));
    reveal.setValue(0);
    Animated.timing(reveal, { toValue: width, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(
      ({ finished }) => !finished && setShown(width),
    );
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
  }, [points, width, reveal, pulse]);

  // Only the last half hour: the hour ahead is what matters.
  const past = useMemo(() => history.filter((p) => p.minute >= -30 && p.minute < 0).sort((a, b) => a.minute - b.minute), [history]);
  const start = past.length || events.some((e) => e.minute < 0 && e.minute >= -30) ? -30 : 0;
  const [minV, maxV] = useMemo(() => focusRange(points, past.map((p) => p.bg)), [points, past]);
  const kind = useMemo(() => riskKind(points), [points]);
  if (width <= 0 || points.length < 2) return <View style={{ height: FORECAST_HEIGHT }} />;

  const w = width - PAD.left - PAD.right;
  const h = PLOT - PAD.top - PAD.bottom;
  const bottom = PAD.top + h;
  const nowX = PAD.left + (start < 0 ? w * PAST_SHARE : 0);
  const x = (m: number) => {
    const t = Math.max(start, Math.min(60, m));
    return t < 0 ? PAD.left + ((t - start) / -start) * (nowX - PAD.left) : nowX + (t / 60) * (PAD.left + w - nowX);
  };
  const minuteAt = (px: number) => (px < nowX && start < 0 ? start + ((px - PAD.left) / (nowX - PAD.left)) * -start : ((px - nowX) / (PAD.left + w - nowX)) * 60);
  const y = (v: number) => bottom - ((Math.max(minV, Math.min(maxV, v)) - minV) / (maxV - minV)) * h;
  const clock = (m: number) => new Date(new Date(startAt).getTime() + m * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const path = (key: 'low' | 'mid' | 'high') => points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.minute)} ${y(p[key])}`).join(' ');
  const band = `${path('high')} ${[...points].reverse().map((p) => `L ${x(p.minute)} ${y(p.low)}`).join(' ')} Z`;

  const hiY = y(RANGE_HIGH);
  const loY = y(RANGE_LOW);
  const first = points[0];
  const last = points[points.length - 1];
  const cross = crossing(points);
  const top = extreme(points, kind);
  // Worth pointing at: out of range, or a clear move from now.
  const showTop = kind === 'spike' ? top.mid > RANGE_HIGH || top.mid - first.mid >= 15 : top.mid < RANGE_LOW || first.mid - top.mid >= 15;
  const done = shown >= width - 1;
  const sel = picked != null ? points[picked] : null;
  const riskColor = kind === 'spike' ? colors.warning : colors.danger;

  const onPress = (e: GestureResponderEvent) => {
    const m = minuteAt(e.nativeEvent.locationX);
    if (m < 0) return setPicked(null);
    const i = points.reduce((best, p, j) => (Math.abs(p.minute - m) < Math.abs(points[best].minute - m) ? j : best), 0);
    setPicked(i === picked ? null : i);
  };

  const pill = (px: number, py: number, label: string, fill: string, below = false) => {
    const bw = label.length * 6.9 + 18;
    const bx = Math.min(Math.max(px - bw / 2, 2), width - bw - 2);
    const by = below ? Math.min(py + 12, bottom - 26) : Math.max(2, py - 34);
    return (
      <G>
        <Rect x={bx} y={by} width={bw} height={24} rx={12} fill={fill} />
        <SvgText x={bx + bw / 2} y={by + 16.5} fontSize="12.5" fill="#fff" textAnchor="middle" {...BOLD}>
          {label}
        </SvgText>
      </G>
    );
  };

  // The spike (or low) itself: between the line and the limit it crosses.
  const area =
    kind === 'spike'
      ? `${path('mid')} L ${x(last.minute)} ${hiY} L ${x(first.minute)} ${hiY} Z`
      : `${path('mid')} L ${x(last.minute)} ${loY} L ${x(first.minute)} ${loY} Z`;

  const riskY = PLOT + 6;
  const laneY = (i: number) => PLOT + RISK + i * LANE;
  const fit = (text: string, space: number) => (text.length * 6.8 <= space ? text : '');
  const bar = (from: number, to: number, lane: number, label: string) => (
    <G>
      <Rect x={x(from)} y={laneY(lane) + 4} width={Math.max(8, x(to) - x(from))} height={18} rx={9} fill={colors.primarySoft} stroke={colors.primary} strokeDasharray="4 3" />
      <SvgText x={x(from) + 8} y={laneY(lane) + 17} fontSize="12" fill={colors.primaryDark} {...BOLD}>
        {fit(label, x(to) - x(from) - 12) || fit(label.split(' ').slice(0, 2).join(' '), x(to) - x(from) - 12)}
      </SvgText>
    </G>
  );

  const ticks = [0, 15, 30, 45, 60];
  const tickText = (m: number) => (m === 0 ? 'Now' : m === 60 ? '60 min' : String(m));
  const peakNote = `${kind === 'spike' ? 'Peak' : 'Lowest'} ${top.mid} · ${clock(top.minute)}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="image"
      accessibilityLabel={
        `Next 60 minutes: from ${first.mid} to about ${last.mid}, likely between ${last.low} and ${last.high} milligrams per decilitre.` +
        (cross ? ` ${cross.limit === 180 ? 'Above 180' : 'Below 70'} from ${clock(cross.minute)}.` : '') +
        (showTop ? ` ${peakNote}.` : '')
      }
    >
      <Svg width={width} height={FORECAST_HEIGHT}>
        <Defs>
          <LinearGradient id={`b${uid}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={0.03} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0.1} />
          </LinearGradient>
          <ClipPath id={`c${uid}`}>
            <Rect x={0} y={PAD.top} width={shown} height={h} />
          </ClipPath>
          {/* One clip per zone, so the line takes the zone's colour. */}
          <ClipPath id={`hi${uid}`}>
            <Rect x={0} y={0} width={shown} height={Math.max(0, hiY)} />
          </ClipPath>
          <ClipPath id={`ok${uid}`}>
            <Rect x={0} y={hiY} width={shown} height={Math.max(0, loY - hiY)} />
          </ClipPath>
          <ClipPath id={`lo${uid}`}>
            <Rect x={0} y={loY} width={shown} height={Math.max(0, bottom - loY)} />
          </ClipPath>
        </Defs>

        {/* Zones: high, target, low. */}
        <Rect x={PAD.left} y={PAD.top} width={w} height={Math.max(0, hiY - PAD.top)} fill={colors.warningSoft} />
        <Rect x={PAD.left} y={hiY} width={w} height={Math.max(0, loY - hiY)} fill={colors.successSoft} />
        <Rect x={PAD.left} y={loY} width={w} height={Math.max(0, bottom - loY)} fill={colors.dangerSoft} />
        {start < 0 ? <Rect x={PAD.left} y={PAD.top} width={nowX - PAD.left} height={h} fill={colors.card} opacity={0.55} /> : null}
        {top.mid <= RANGE_HIGH ? (
          <SvgText x={x(0) + 6} y={PAD.top + 14} fontSize="11" fill={colors.warningText} {...FONT}>
            Spike zone, above 180
          </SvgText>
        ) : null}
        {loY < bottom - 14 && kind === 'low' && top.mid >= RANGE_LOW ? (
          <SvgText x={x(0) + 6} y={bottom - 5} fontSize="11" fill={colors.dangerText} textAnchor="end" {...FONT}>
            Low, below 70
          </SvgText>
        ) : null}

        {[15, 30, 45].map((m) => (
          <Line key={m} x1={x(m)} y1={PAD.top} x2={x(m)} y2={bottom} stroke={colors.border} strokeDasharray="2 4" />
        ))}
        <Line x1={x(0)} y1={PAD.top - 6} x2={x(0)} y2={PLOT + RISK + LANES.length * LANE} stroke={colors.textMuted} strokeWidth={1.5} />
        {ticks.map((m) => (
          <SvgText
            key={m}
            x={x(m)}
            y={bottom + 18}
            fontSize="11.5"
            fill={m === 0 ? colors.text : colors.textFaint}
            textAnchor={m === 60 ? 'end' : 'middle'}
            {...(m === 0 ? BOLD : FONT)}
          >
            {tickText(m)}
          </SvgText>
        ))}
        {[RANGE_LOW, RANGE_HIGH].map((v) => (
          <SvgText key={v} x={PAD.left - 7} y={y(v) + 4} fontSize="11.5" fill={colors.textMuted} textAnchor="end" {...FONT}>
            {v}
          </SvgText>
        ))}
        <Line x1={PAD.left} x2={PAD.left + w} y1={hiY} y2={hiY} stroke={colors.warning} strokeOpacity={0.6} />
        <Line x1={PAD.left} x2={PAD.left + w} y1={loY} y2={loY} stroke={colors.danger} strokeOpacity={0.5} />

        {/* Likely range, then the spike area, then the line. */}
        <Path d={band} fill={`url(#b${uid})`} clipPath={`url(#c${uid})`} />
        {(['high', 'low'] as const).map((k) => (
          <Path key={k} d={path(k)} stroke={colors.textFaint} strokeWidth={1.2} strokeDasharray="4 4" fill="none" clipPath={`url(#c${uid})`} />
        ))}
        <Path d={area} fill={riskColor} opacity={0.45} clipPath={`url(#${kind === 'spike' ? 'hi' : 'lo'}${uid})`} />
        {(
          [
            ['hi', colors.warning],
            ['ok', colors.primary],
            ['lo', colors.danger],
          ] as const
        ).map(([zone, color]) => (
          <Path key={zone} d={path('mid')} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${zone}${uid})`} />
        ))}

        {past.length ? (
          <Path
            d={[...past.map((p) => ({ m: p.minute, v: p.bg })), { m: 0, v: first.mid }].map((p, i) => `${i ? 'L' : 'M'} ${x(p.m)} ${y(p.v)}`).join(' ')}
            stroke={colors.textMuted}
            strokeWidth={2.5}
            fill="none"
            strokeLinejoin="round"
          />
        ) : null}
        {past.map((p) => (
          <G key={p.minute}>
            <Circle cx={x(p.minute)} cy={y(p.bg)} r={5.5} fill={colors.card} />
            <Circle cx={x(p.minute)} cy={y(p.bg)} r={4} fill={zoneColor(p.bg)} />
          </G>
        ))}
        {events
          .filter((e) => e.minute >= start)
          .map((e, j) => (
            <Line key={`v${j}`} x1={x(e.minute)} x2={x(e.minute)} y1={PAD.top} y2={bottom} stroke={colors.textFaint} strokeDasharray="2 4" />
          ))}

        {/* Where it crosses the limit. */}
        {done && cross ? (
          <G>
            <Circle cx={x(cross.minute)} cy={y(cross.limit)} r={6} fill={colors.card} stroke={cross.limit === 180 ? colors.warning : colors.danger} strokeWidth={3} />
            {showTop && Math.abs(top.minute - cross.minute) <= 20 ? null : <SvgText
              x={x(cross.minute) + (x(cross.minute) > PAD.left + w * 0.6 ? -10 : 10)}
              y={cross.limit === 180 ? y(cross.limit) + 18 : y(cross.limit) - 9}
              fontSize="12"
              fill={cross.limit === 180 ? colors.warningText : colors.dangerText}
              textAnchor={x(cross.minute) > PAD.left + w * 0.6 ? 'end' : 'start'}
              {...BOLD}
            >
              {cross.limit === 180 ? 'Over 180' : 'Under 70'} at {clock(cross.minute)}
            </SvgText>}
          </G>
        ) : null}

        <Circle cx={x(0)} cy={y(first.mid)} r={6.5} fill={colors.card} />
        <Circle cx={x(0)} cy={y(first.mid)} r={4.5} fill={zoneColor(first.mid)} />
        {done ? (
          <>
            <Circle cx={x(last.minute)} cy={y(last.mid)} r={7} fill={colors.card} />
            <Circle cx={x(last.minute)} cy={y(last.mid)} r={5} fill={zoneColor(last.mid)} />
            {showTop && top !== last ? <Circle cx={x(top.minute)} cy={y(top.mid)} r={6} fill={zoneColor(top.mid)} stroke={colors.card} strokeWidth={2} /> : null}
            {sel ? (
              <>
                <Line x1={x(sel.minute)} x2={x(sel.minute)} y1={PAD.top} y2={bottom} stroke={colors.text} strokeOpacity={0.4} />
                <Circle cx={x(sel.minute)} cy={y(sel.mid)} r={5} fill={zoneColor(sel.mid)} stroke={colors.card} strokeWidth={2} />
                {pill(x(sel.minute), y(sel.mid), `${sel.mid} · ${Math.round(chanceAt(sel, kind) * 100)}% ${kind === 'spike' ? 'over 180' : 'under 70'} · ${clock(sel.minute)}`, colors.ink)}
              </>
            ) : (
              <>
                {showTop ? pill(x(top.minute), y(top.mid), peakNote, zoneColor(top.mid), kind === 'low') : null}
                {!showTop || (endLabel && top !== last) || top.minute < 45
                  ? pill(x(last.minute), y(last.mid), endLabel ?? `about ${last.mid} (${signed(last.mid - first.mid)})`, zoneColor(last.mid), kind === 'spike' && showTop)
                  : null}
              </>
            )}
          </>
        ) : null}

        {/* Risk strip: how likely a spike (or low) is at each moment. */}
        <SvgText x={4} y={riskY + 14} fontSize="12" fill={colors.text} {...BOLD}>
          {kind === 'spike' ? 'Spike risk' : 'Low risk'}
        </SvgText>
        {points.slice(1).map((p, i) => {
          const a = x(points[i].minute);
          const chance = (chanceAt(points[i], kind) + chanceAt(p, kind)) / 2;
          return (
            <Rect
              key={p.minute}
              x={a + 1}
              y={riskY}
              width={Math.max(1, x(p.minute) - a - 2)}
              height={20}
              rx={3}
              fill={chance < 0.05 ? colors.surfaceMuted : riskColor}
              opacity={chance < 0.05 ? 1 : 0.15 + 0.85 * chance}
            />
          );
        })}
        <SvgText x={x(0) - 6} y={riskY + 32} fontSize="10.5" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {start < 0 ? 'pale = unlikely' : ''}
        </SvgText>
        <SvgText x={PAD.left + w} y={riskY + 32} fontSize="10.5" fill={colors.textFaint} textAnchor="end" {...FONT}>
          {start < 0 ? 'dark = likely' : 'pale = unlikely · dark = likely'}
        </SvgText>

        {/* Meals, insulin and activity on the same time axis. */}
        {LANES.map((lane, i) => (
          <G key={lane}>
            <SvgText x={4} y={laneY(i) + 17} fontSize="12" fill={colors.textMuted} {...FONT}>
              {LANE_LABEL[lane]}
            </SvgText>
            <Line x1={PAD.left} x2={width - PAD.right} y1={laneY(i) + 13} y2={laneY(i) + 13} stroke={colors.border} />
            {lane === 'insulin' && planned.insulin ? bar(15, 60, i, `${planned.insulin.units} u starts working`) : null}
            {lane === 'activity' && planned.activity ? bar(2, 2 + planned.activity.minutes, i, '') : null}
            {events
              .filter((e) => e.kind === lane && e.minute >= start)
              .map((e, j) => {
                const label = lane === 'food' ? `${e.amount} g` : lane === 'insulin' ? `${e.amount} u` : `${e.amount} min`;
                const right = x(e.minute) + 12 + label.length * 7 > width;
                return (
                  <G key={`${lane}${j}`}>
                    <Circle cx={x(e.minute)} cy={laneY(i) + 13} r={6} fill={colors.primary} stroke={colors.card} strokeWidth={2} />
                    <Rect x={right ? x(e.minute) - 16 - label.length * 7 : x(e.minute) + 9} y={laneY(i) + 4} width={label.length * 7 + 8} height={18} rx={9} fill={colors.card} />
                    <SvgText x={right ? x(e.minute) - 12 : x(e.minute) + 13} y={laneY(i) + 17} fontSize="12" fill={colors.text} textAnchor={right ? 'end' : 'start'} {...BOLD}>
                      {label}
                    </SvgText>
                  </G>
                );
              })}
            {lane === 'activity' && planned.activity ? (
              <SvgText x={x(2 + planned.activity.minutes) + 6} y={laneY(i) + 17} fontSize="12" fill={colors.text} {...BOLD}>
                {fit(planned.activity.label, width - PAD.right - x(2 + planned.activity.minutes) - 6)}
              </SvgText>
            ) : null}
          </G>
        ))}
      </Svg>

      {done && !sel ? (
        <Animated.View
          style={[
            styles.halo,
            {
              pointerEvents: 'none',
              left: x((showTop ? top : last).minute) - 15,
              top: y((showTop ? top : last).mid) - 15,
              backgroundColor: zoneColor((showTop ? top : last).mid),
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.7] }) }],
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  halo: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
});
