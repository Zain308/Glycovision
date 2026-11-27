// lib/backgroundSync.ts
//
// Keeps activity up to date while the app is closed, and reminds the user to
// stand up after sitting for long (both only if they turned it on).
// Android decides the exact time: usually every 15 to 30 minutes, later when
// the battery is low. It stops if the user force-closes the app; the step counter itself
// (lib/stepRecorder.ts) keeps counting on the phone.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { syncNow } from '@/lib/healthConnect';
import { moveReminder } from '@/lib/notifications';
import { storedSession } from '@/lib/supabase';
import { flush, openOutbox } from '@/lib/offline';
import { getFitness } from '@/services/api';

const TASK = 'gv-health-sync';
const KEY_MOVE = 'gv.moveReminders';
const KEY_LAST_MOVE = 'gv.moveReminders.last';
export const SIT_LIMIT_MIN = 60;
const MIN_GAP_MS = 60 * 60 * 1000;

export async function moveRemindersOn(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY_MOVE).catch(() => null)) === '1';
}

export async function setMoveReminders(on: boolean) {
  await AsyncStorage.setItem(KEY_MOVE, on ? '1' : '0');
}

/** Remind after an hour of sitting, at most once an hour. Pure, for tests. */
export function shouldRemind(sittingMin: number | null | undefined, lastReminder: number, now: number): boolean {
  return (sittingMin ?? 0) >= SIT_LIMIT_MIN && now - lastReminder >= MIN_GAP_MS;
}

if (Platform.OS === 'android') {
  TaskManager.defineTask(TASK, async () => {
    try {
      const uid = (await storedSession())?.user.id;
      if (uid) {
        await openOutbox(uid);
        await flush();
      }
      await syncNow();
      if (await moveRemindersOn()) {
        const { today } = await getFitness();
        const last = Number(await AsyncStorage.getItem(KEY_LAST_MOVE)) || 0;
        if (shouldRemind(today.sitting_min, last, Date.now())) {
          await AsyncStorage.setItem(KEY_LAST_MOVE, String(Date.now()));
          await moveReminder(today.sitting_min ?? SIT_LIMIT_MIN);
        }
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      console.log('[background] sync failed', e);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function backgroundOn(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return TaskManager.isTaskRegisteredAsync(TASK).catch(() => false);
}

export async function setBackground(on: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (on) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    else if (await backgroundOn()) await BackgroundTask.unregisterTaskAsync(TASK);
    return true;
  } catch (e) {
    console.log('[background] change failed', e);
    return false;
  }
}
