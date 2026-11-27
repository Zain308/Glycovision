// components/fitness/BarChart.tsx
//
// Simple bars for a day (24 hours) or a week/month. Tap a bar to see its
// value. Missing days are left empty, never drawn as zero.

import React, { useState } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/ui/Typography';
import { colors, tabular } from '@/constants/theme';
import { niceTop } from '@/lib/fitness';

const FONT = { fontFamily: 'PlusJakartaSans_600SemiBold' };

export type BarItem = { label: string; axis?: string; value: number | null };

export function BarChart({
  items,
  goal,
  height = 150,
  color = colors.primary,
  format,
  summary,
}: {
  items: BarItem[];
  goal?: number | null;
  height?: number;
  color?: string;
  format: (v: number | null) => string;
  /** Shown above the bars until one is tapped. */
  summary: string;
}) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const values = items.map((i) => i.value).filter((v): v is number => v != null);
  const top = niceTop(Math.max(goal ?? 0, ...values, 0));
  const base = height - 22;
  const y = (v: number) => base - (Math.min(v, top) / top) * (base - 8);
  const right = 34;
  const slot = Math.max(0, width - right) / items.length;
  const bw = Math.max(3, Math.min(26, slot - Math.max(2, slot * 0.28)));
  const sel = picked != null && picked < items.length ? items[picked] : null;

  const onPress = (e: GestureResponderEvent) => {
    const i = Math.floor(e.nativeEvent.locationX / (slot || 1));
    setPicked(i < 0 || i >= items.length || i === picked ? null : i);
  };

  return (
    <View>
      <Text style={styles.summary} accessibilityLiveRegion="polite">
        {sel ? `${sel.label}: ${sel.value == null ? 'no data' : format(sel.value)}` : summary}
      </Text>
      <Pressable
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        onPress={onPress}
        style={{ minHeight: height }}
        accessibilityRole="image"
        accessibilityLabel={`${summary}. ${items.filter((i) => i.value != null).map((i) => `${i.label} ${format(i.value)}`).join(', ')}`}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[top / 2, top].map((v) => (
              <React.Fragment key={v}>
                <Line x1={0} x2={width - right} y1={y(v)} y2={y(v)} stroke={colors.divider} />
                <SvgText x={width} y={y(v) + 4} fontSize="11" fill={colors.textFaint} textAnchor="end" {...FONT}>
                  {v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : +v.toFixed(1)}
                </SvgText>
              </React.Fragment>
            ))}
            <Line x1={0} x2={width - right} y1={base} y2={base} stroke={colors.border} />
            {items.map((item, i) => {
              const x = slot * (i + 0.5);
              const on = picked == null || picked === i;
              return (
                <React.Fragment key={i}>
                  {item.value ? <Rect x={x - bw / 2} y={y(item.value)} width={bw} height={Math.max(2, base - y(item.value))} rx={Math.min(4, bw / 2)} fill={color} fillOpacity={on ? 1 : 0.35} /> : null}
                  {item.axis ? (
                    <SvgText x={i === 0 && items.length > 10 ? 0 : x} y={height - 6} fontSize="11.5" fill={colors.textMuted} textAnchor={i === 0 && items.length > 10 ? 'start' : 'middle'} {...FONT}>
                      {item.axis}
                    </SvgText>
                  ) : null}
                </React.Fragment>
              );
            })}
            {goal ? (
              <>
                <Line x1={0} x2={width - right} y1={y(goal)} y2={y(goal)} stroke={colors.textMuted} strokeDasharray="4 4" />
                {Math.abs(y(goal) - y(top)) > 11 && Math.abs(y(goal) - y(top / 2)) > 11 ? (
                  <SvgText x={width} y={y(goal) + 4} fontSize="11" fill={colors.textMuted} textAnchor="end" {...FONT}>
                    goal
                  </SvgText>
                ) : null}
              </>
            ) : null}
          </Svg>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6, ...tabular },
});
