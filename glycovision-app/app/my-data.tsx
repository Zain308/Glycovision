// app/my-data.tsx
// The user's own data: what is kept, download everything, delete everything.

import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';

import { Text, TextInput } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/Bits';
import { colors, radius } from '@/constants/theme';
import { setBackground } from '@/lib/backgroundSync';
import { stopRecorder } from '@/lib/stepRecorder';
import { scheduleMedicines } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { copyTime } from '@/components/OfflineCards';
import { flush, removeProblem, useOffline } from '@/lib/offline';
import { entryName } from '@/lib/offlineView';
import { deleteMyAccount, exportMyData } from '@/services/api';

const KEPT: [React.ComponentProps<typeof Ionicons>['name'], string][] = [
  ['water-outline', 'Blood sugar, meals, insulin and medicines you log'],
  ['footsteps-outline', 'Steps, heart rate, sleep and body numbers you connect or type in'],
  ['mic-outline', 'Scores from voice checks. Recordings are deleted after analysis'],
  ['person-outline', 'Your name, email and profile'],
];

export default function MyDataScreen() {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [word, setWord] = useState('');
  const net = useOffline();
  const [uploading, setUploading] = useState(false);

  const uploadNow = async () => {
    setUploading(true);
    await flush().catch(() => {});
    setUploading(false);
  };

  const download = async () => {
    setBusy('export');
    try {
      const json = JSON.stringify(await exportMyData(), null, 1);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'glycovision-my-data.json';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, 'glycovision-my-data.json');
        if (file.exists) file.delete();
        file.create();
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your data' });
      }
    } catch (e) {
      console.log('Export failed', e);
      Alert.alert('Could not prepare your data', 'Check your internet and try again.');
    } finally {
      setBusy(null);
    }
  };

  const askDelete = () =>
    Alert.alert('Delete everything?', 'Your account and all your health data will be deleted for good. This can’t be undone.', [
      { text: 'Keep my account', style: 'cancel' },
      { text: 'Delete for good', style: 'destructive', onPress: remove },
    ]);

  const remove = async () => {
    setBusy('delete');
    try {
      await deleteMyAccount();
    } catch {
      setBusy(null);
      Alert.alert('Not deleted', 'Something went wrong and your account was kept. Check your internet and try again.');
      return;
    }
    // The server part is done. Clean this phone too, then leave.
    await Promise.all([stopRecorder(), setBackground(false), scheduleMedicines([], false)]).catch(() => {});
    const mine = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith('gv.'));
    await AsyncStorage.multiRemove([...mine]).catch(() => {});
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  };

  return (
    <Screen
      title="Your data"
      subtitle="It belongs to you."
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      }
    >
      <SectionHeader title="Upload" />
      <Card>
        <View style={styles.row}>
          <Ionicons name={net.waiting.length ? 'cloud-upload-outline' : 'cloud-done-outline'} size={20} color={colors.primary} />
          <Text style={styles.body}>
            {net.waiting.length
              ? `${net.waiting.length} saved on this phone, waiting to upload. Keep the app installed and stay signed in.`
              : net.offline
                ? 'No internet. What you log is kept on this phone until you are online.'
                : 'Everything is uploaded.'}
          </Text>
        </View>
        {net.waiting.slice(0, 20).map((e) => (
          <View key={e.id} style={styles.entry}>
            <Text style={styles.entryName}>{entryName(e)}</Text>
            <Text style={[styles.caption, e.note ? { color: colors.warningText } : null]}>{e.note ? `${copyTime(e.at)} · ${e.note}` : copyTime(e.at)}</Text>
          </View>
        ))}
        {net.waiting.length ? (
          <Button label="Upload now" icon="refresh" size="md" variant="secondary" onPress={uploadNow} loading={uploading} style={{ marginTop: 10 }} />
        ) : null}
        {net.problems.map((e) => (
          <View key={e.id} style={styles.entry}>
            <View style={{ flex: 1 }}>
              <Text style={styles.entryName}>{entryName(e)}</Text>
              <Text style={[styles.caption, { color: colors.warningText }]}>
                {copyTime(e.at)} · Not saved: {e.problem}
              </Text>
            </View>
            <Pressable onPress={() => removeProblem(e.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${entryName(e)}`} style={styles.close}>
              <Ionicons name="close-circle" size={22} color={colors.textFaint} />
            </Pressable>
          </View>
        ))}
      </Card>

      <SectionHeader title="What we keep" />
      <Card>
        {KEPT.map(([icon, text]) => (
          <View key={text} style={styles.row}>
            <Ionicons name={icon} size={20} color={colors.primary} />
            <Text style={styles.body}>{text}</Text>
          </View>
        ))}
        <Text style={styles.caption}>It is stored in our online database (Supabase), with a copy on this phone for use without internet. It is used only to run GlycoVision for you. We don’t sell it or show ads.</Text>
      </Card>

      <SectionHeader title="Download" />
      <Card>
        <Text style={styles.text}>Get a copy of everything as one file.</Text>
        <Button label="Download my data" icon="download-outline" size="md" variant="secondary" onPress={download} loading={busy === 'export'} disabled={!!busy} style={{ marginTop: 12 }} />
      </Card>

      <SectionHeader title="Delete" />
      <Card>
        <Text style={styles.text}>Deletes your account and all your health data for good. Download a copy first if you want to keep it.</Text>
        <Text style={styles.label}>Type DELETE to continue</Text>
        <TextInput style={styles.input} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} maxLength={10} accessibilityLabel="Type DELETE to continue" />
        <Button label="Delete my account" icon="trash-outline" size="md" variant="secondary" onPress={askDelete} loading={busy === 'delete'} disabled={!!busy || word.trim() !== 'DELETE'} style={{ marginTop: 12 }} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  body: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  entry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, marginTop: 6 },
  entryName: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  text: { fontSize: 15, lineHeight: 21, color: colors.textMuted },
  caption: { fontSize: 13.5, lineHeight: 19, color: colors.textFaint, marginTop: 4 },
  label: { fontSize: 14, fontWeight: '700', color: colors.textMuted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.input, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 54, fontSize: 17, color: colors.text },
});
