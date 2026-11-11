// components/ui/AnimatedPressable.tsx
import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

interface AnimatedPressableProps extends PressableProps {
  // Styles the animated content (background, padding, radius).
  style?: StyleProp<ViewStyle>;
  // Styles the outer touch area. Put layout here (e.g. flex: 1 in a row);
  // on `style` it only sizes the inner view, so the pressable shrinks.
  containerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function AnimatedPressable({ style, containerStyle, children, onPressIn, onPressOut, ...rest }: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} style={containerStyle} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}