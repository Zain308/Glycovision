// lib/useOfflineSync.ts
// Runs once at the root: watches the connection and uploads what is waiting.

import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { closeOutbox, flush, offlineState, openOutbox, setConnection } from '@/lib/offline';
import { keepForLater } from '@/services/api';

const RETRY_MS = 30_000;

export function useOfflineSync(uid: string | null) {
  useEffect(
    () =>
      // Only "no connection at all" counts: a blocked reachability test must
      // not stop the app from trying.
      NetInfo.addEventListener((s) => setConnection(s.isConnected !== false)),
    [],
  );

  useEffect(() => {
    if (!uid) {
      closeOutbox();
      return;
    }
    const upload = () => flush().catch(() => {});
    openOutbox(uid).then(upload).then(keepForLater).catch(() => {});
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') upload();
    });
    const timer = setInterval(() => {
      if (offlineState().waiting.length && AppState.currentState === 'active') upload();
    }, RETRY_MS);
    return () => {
      app.remove();
      clearInterval(timer);
    };
  }, [uid]);
}
