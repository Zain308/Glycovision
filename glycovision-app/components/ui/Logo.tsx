// components/ui/Logo.tsx
//
// GlycoVision mark: a blood drop with a pulse line through it, on a
// rounded blue tile. Drawn as SVG so it stays sharp at any size; the
// same drawing is exported to assets/images/icon.png for the app icon.

import React, { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export function LogoMark({ size = 56, tile = true }: { size?: number; tile?: boolean }) {
  // Unique gradient ids per logo: two logos on one page must not share ids.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tileId = `gvTile${uid}`;
  const dropId = `gvDrop${uid}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="GlycoVision logo">
      <Defs>
        <LinearGradient id={tileId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2B7BEF" />
          <Stop offset="1" stopColor="#1257C4" />
        </LinearGradient>
        <LinearGradient id={dropId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#DCE9FF" />
        </LinearGradient>
      </Defs>
      {tile ? <Rect x="0" y="0" width="64" height="64" rx="18" fill={`url(#${tileId})`} /> : null}
      {/* Drop */}
      <Path
        d="M32 10 C32 10 16 28.5 16 39.5 C16 48.6 23.2 55 32 55 C40.8 55 48 48.6 48 39.5 C48 28.5 32 10 32 10 Z"
        fill={tile ? `url(#${dropId})` : '#1E6FE8'}
      />
      {/* Pulse line */}
      <Path
        d="M19.5 40 H26 L29 34 L33.5 46 L37 37.5 L39 40 H44.5"
        fill="none"
        stroke={tile ? '#1565D8' : '#FFFFFF'}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
