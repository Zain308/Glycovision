import { AppState, Platform } from 'react-native';
import { createClient, type Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// With web static output, Expo renders the app once inside Node.js on
// the dev machine. There is no `window` there, so AsyncStorage's web
// implementation (localStorage) throws "window is not defined" and
// crashes the dev server. During that render, keep the session in
// memory only; phones and real browsers keep using persistent storage.
const isServerRender = Platform.OS === 'web' && typeof window === 'undefined';

// The name Supabase uses by default, spelled out so the signed-in user can be
// read without internet (an expired token can't be renewed offline, but the
// person is still signed in).
const SESSION_KEY = `sb-${SUPABASE_URL.replace(/^https?:\/\//, '').split(/[.:/]/)[0]}-auth-token`;

/** The login kept on this phone, even when its token has expired. */
export async function storedSession(): Promise<Session | null> {
  if (isServerRender) return null;
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    return session?.user?.id && session?.refresh_token ? session : null;
  } catch {
    return null;
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(isServerRender ? {} : { storage: AsyncStorage, storageKey: SESSION_KEY }),
    autoRefreshToken: !isServerRender,
    persistSession: !isServerRender,
    detectSessionInUrl: false,
    // Google sign-in returns a one-time code instead of tokens in the link.
    flowType: 'pkce',
  },
});

// Supabase's refresh loop only runs reliably while the app is in the
// foreground on React Native. Tie it to AppState so tokens don't go
// stale after backgrounding/locking the device.
if (!isServerRender) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}