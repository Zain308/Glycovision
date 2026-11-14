// components/ScanPhoto.tsx
//
// The meal photo while it is being analysed: rounded image, four corner
// brackets and a soft blue scan line sweeping up and down, so the wait
// feels purposeful rather than frozen.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius } from '@/constants/theme';

const SIZE = 248;

export function ScanPhoto({ uri }: { uri: string }) {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  return (
    <View style={styles.wrap}>
      <Image source={{ uri }} style={styles.image} />
      <View style={styles.dim} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.beam,
          { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [8, SIZE - 46] }) }] },
        ]}
      >
        <LinearGradient
          colors={['rgba(30,111,232,0)', 'rgba(30,111,232,0.35)', 'rgba(30,111,232,0)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.beamLine} />
      </Animated.View>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.corner, styles[c]]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  image: { width: '100%', height: '100%' },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,26,46,0.12)' },
  beam: { position: 'absolute', left: 0, right: 0, height: 38, justifyContent: 'center' },
  beamLine: { height: 2.5, marginHorizontal: 14, borderRadius: 2, backgroundColor: '#FFFFFF', opacity: 0.95 },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: '#FFFFFF' },
  tl: { top: 14, left: 14, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 14, right: 14, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 14, right: 14, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
});
