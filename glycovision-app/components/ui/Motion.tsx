// components/ui/Motion.tsx
//
// Small motion helpers so the app feels alive but calm:
//   <Reveal index={n}>  fades and rises in, staggered by index
//   <AnimatedNumber>    counts up to a value (glucose, carbs, dose)
// Both respect the phone's "reduce motion" setting.

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleProp, TextStyle, ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Typography';

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

export function Reveal({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, {
      toValue: 1,
      duration: 460,
      delay: 70 * index,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) v.setValue(1); // never stay hidden if interrupted
    });
  }, [v, index, reduce]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 900,
  style,
  prefix = '',
}: {
  value: number | null | undefined;
  decimals?: number;
  duration?: number;
  style?: StyleProp<TextStyle>;
  prefix?: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const reduce = useReduceMotion();
  const from = useRef(0);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    if (reduce) {
      setShown(value);
      return;
    }
    anim.setValue(0);
    const start = from.current;
    const id = anim.addListener(({ value: p }) => setShown(start + (value - start) * p));
    Animated.timing(anim, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      from.current = value;
    });
    return () => anim.removeListener(id);
  }, [value, duration, anim, reduce]);

  if (value == null || !Number.isFinite(value)) return <Text style={style}>—</Text>;
  return (
    <Text style={style} accessibilityLabel={`${prefix}${value.toFixed(decimals)}`}>
      {prefix}
      {shown.toFixed(decimals)}
    </Text>
  );
}
