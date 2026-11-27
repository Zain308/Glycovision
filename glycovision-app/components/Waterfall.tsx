// components/Waterfall.tsx
//
// How the next hour adds up: sugar now, plus or minus each input, equals
// the sugar expected in an hour. The bars come from the same sum as the
// forecast line, so they always end on the same number.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/ui/Typography';
import { colors } from '@/constants/theme';
import { signed, waterfall } from '@/lib/flow';
import type { Forecast } from '@/services/api';

const H = 150;
const TOP = 26;
const BASE = H - 26;
const FONT = { fontFamily: 'PlusJakartaSans_600SemiBold' };
const BOLD = { fontFamily: 'PlusJakartaSans_800ExtraBold' };

export function Waterfall({ forecast }: { forecast: Forecast }) {
  const [width, setWidth] = useState(0);
  const bars = waterfall(forecast);
  if (bars.length < 3) return null;

  const tops = bars.map((b) => Math.max(b.from, b.to));
  const floats = bars.filter((b) => !b.total).flatMap((b) => [b.from, b.to]);
  const hi = Math.max(...tops, ...floats);
  const lo = Math.min(...bars.filter((b) => b.total).map((b) => b.to), ...floats);
  // Totals are level marks, not bars, so the axis can start near the values.
  const min = lo - Math.max(6, (hi - lo) * 0.25);
  const y = (v: number) => BASE - ((Math.max(min, v) - min) / (hi - min || 1)) * (BASE - TOP);
  const slot = width / bars.length;
  const bw = Math.min(46, slot * 0.66);

  return (
    <View>
      <Text style={styles.title}>How it adds up</Text>
      <View
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        style={{ minHeight: H }}
        accessible
        accessibilityLabel={bars.map((b) => `${b.label} ${b.total ? b.value : signed(b.value)}`).join(', ')}
      >
        {width > 0 ? (
          <Svg width={width} height={H}>
            {bars.map((b, i) => {
              const cx = slot * (i + 0.5);
              const top = b.total ? y(b.to) - 5 : Math.min(y(b.from), y(b.to));
              const height = b.total ? 10 : Math.max(3, Math.abs(y(b.from) - y(b.to)));
              const next = bars[i + 1];
              const color = b.total ? colors.primary : b.value > 0 ? colors.warning : colors.info;
              return (
                <React.Fragment key={b.key}>
                  <Rect x={cx - bw / 2} y={top} width={bw} height={height} rx={b.total ? 5 : 4} fill={color} />
                  {next ? <Line x1={cx + bw / 2} x2={cx + slot - bw / 2} y1={y(b.to)} y2={y(b.to)} stroke={colors.textFaint} strokeDasharray="2 3" /> : null}
                  <SvgText x={cx} y={top - 6} fontSize="13.5" fill={colors.text} textAnchor="middle" {...BOLD}>
                    {b.total ? String(b.value) : signed(b.value)}
                  </SvgText>
                  <SvgText x={cx} y={H - 8} fontSize={slot < 52 ? '11' : '12.5'} fill={colors.textMuted} textAnchor="middle" {...FONT}>
                    {b.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 18, marginBottom: 6 },
});
