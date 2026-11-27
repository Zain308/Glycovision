// components/AutoVoiceCheck.tsx
//
// Automatic voice checks while the app is open. Off until the user turns it
// on in Activity & stress. Every 15 minutes it records 8 seconds, with a
// visible "Listening" label, and sends the clip for analysis. Clips without
// clear speech, or that don't match the user's usual voice, are thrown away
// by the server. The recording is deleted from the phone straight away.
//
// Android does not let an app start the microphone while it is closed, so
// this runs only while GlycoVision is on screen.

import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Typography';
import { colors, radius } from '@/constants/theme';
import { autoVoiceOn, onAutoVoiceChange } from '@/lib/autoVoice';
import { onStressCheck } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { BASE_URL } from '@/services/api';

const EVERY_MS = 15 * 60 * 1000;
const FIRST_MS = 45 * 1000;
const CLIP_MS = 8000;

function Runner() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [listening, setListening] = useState(false);
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    let alive = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      // Never compete with a recording the user started.
      if (busy || AppState.currentState !== 'active' || pathRef.current.includes('voice')) return;
      busy = true;
      let uri: string | null = null;
      try {
        // Only if permission was already given: no surprise questions.
        if (!(await AudioModule.getRecordingPermissionsAsync()).granted) return;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setListening(true);
        await new Promise((r) => setTimeout(r, CLIP_MS));
        await recorder.stop();
        uri = recorder.uri;
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!uri || !token || !alive) return;
        const res = await FileSystem.uploadAsync(`${BASE_URL}/api/v1/stress-analyze?auto=true`, uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'audio/mp4',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 200) await onStressCheck(JSON.parse(res.body)?.stress_context?.level);
      } catch (e) {
        console.log('[auto voice] skipped', e);
      } finally {
        if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        busy = false;
        if (alive) setListening(false);
      }
    };

    const loop = (delay: number) => {
      timer = setTimeout(async () => {
        await check();
        if (alive) loop(EVERY_MS);
      }, delay);
    };
    loop(FIRST_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [recorder]);

  if (!listening) return null;
  return (
    <View style={styles.pill} accessibilityLiveRegion="polite">
      <Ionicons name="mic" size={15} color="#fff" />
      <Text style={styles.text}>Listening for a stress check</Text>
    </View>
  );
}

export function AutoVoiceCheck() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    autoVoiceOn().then(setOn);
    return onAutoVoiceChange(setOn);
  }, []);
  return on && Platform.OS !== 'web' ? <Runner /> : null;
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    pointerEvents: 'none',
  },
  text: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
});
