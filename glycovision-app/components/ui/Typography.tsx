// components/ui/Typography.tsx
//
// Drop-in replacements for React Native's Text and TextInput that use
// the app font (Plus Jakarta Sans). Screens import { Text, TextInput } from here instead
// of from 'react-native'.
//
// Android can't synthesise bold for a custom font, so fontWeight would be
// ignored. These components read fontWeight from the style and pick the
// matching font file instead.

import React from 'react';
import {
  Platform,
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextProps,
  type TextInputProps,
  type TextStyle,
  type StyleProp,
} from 'react-native';

import { fonts } from '@/constants/theme';

function fontFor(weight: TextStyle['fontWeight']): string {
  switch (String(weight ?? '400')) {
    case '800':
    case '900':
    case 'heavy':
    case 'black':
      return fonts.extrabold;
    case '700':
    case 'bold':
      return fonts.bold;
    case '600':
    case 'semibold':
      return fonts.semibold;
    case '500':
    case 'medium':
      return fonts.medium;
    default:
      return fonts.regular;
  }
}

function withNunito(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  // Respect an explicit font (e.g. a monospace timer).
  if (flat.fontFamily) return style;
  return [style, { fontFamily: fontFor(flat.fontWeight), fontWeight: 'normal' }];
}

// True inside another Text. Nested text without its own fontWeight
// should inherit the parent's font (e.g. "140 <mg/dL>" in a bold value).
const InsideText = React.createContext(false);

export function Text({ style, children, ...rest }: TextProps) {
  const nested = React.useContext(InsideText);
  const ownWeight = StyleSheet.flatten(style)?.fontWeight;
  const finalStyle = nested && ownWeight == null ? style : withNunito(style);

  return (
    <RNText {...rest} style={finalStyle}>
      <InsideText.Provider value={true}>{children}</InsideText.Provider>
    </RNText>
  );
}

// Web browsers draw a black focus box around inputs; the app's fields
// show focus with their own styling instead. (No effect on phones.)
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export function TextInput({ style, ...rest }: TextInputProps) {
  return <RNTextInput {...rest} style={[withNunito(style), webNoOutline]} />;
}
