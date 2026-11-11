import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// With web static output, Expo renders the app once inside Node.js on
// the dev machine. There is no `window` there, so AsyncStorage's web
// implementation (localStorage) throws "window is not defined" and
// crashes the dev server. During that render, keep the session in
// memory only; phones and real browsers keep using persistent storage.
const isServerRender = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(isServerRender ? {} : { storage: AsyncStorage }),
    autoRefreshToken: !isServerRender,
    persistSession: !isServerRender,
    detectSessionInUrl: false,
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