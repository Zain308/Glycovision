// lib/autoVoice.ts
// The on/off switch for automatic voice checks (off by default).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gv.autoVoice';
const listeners = new Set<(on: boolean) => void>();

export async function autoVoiceOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setAutoVoice(on: boolean) {
  await AsyncStorage.setItem(KEY, on ? '1' : '0');
  listeners.forEach((l) => l(on));
}

export function onAutoVoiceChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
