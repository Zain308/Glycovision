// lib/notifications.ts
//
// On-device notifications for GlycoVision. Everything here runs on the
// phone (no server, free), so it works in Expo Go and when the app is
// closed. Three kinds:
//
//  1. Smart health alerts, triggered by what the user logs:
//     - low reading (< 70): alert now + "recheck in 15 minutes" (rule of 15)
//     - very high reading (> 250): recheck in 2 hours
//     - meal logged: after-meal check in 2 hours
//     - high 60-minute rise risk: one alert, at most every 2 hours
//  2. Daily reminders the user turns on (fasting check, bedtime check,
//     insulin / medicine), stored on the phone.
//  3. A low-sugar timer finish alert (Low sugar help screen).
//
// Tapping a notification opens the matching screen (data.url).
// All functions are safe no-ops on web and never throw.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { addInboxItem, type InboxKind } from '@/lib/inbox';

const ENABLED = Platform.OS === 'ios' || Platform.OS === 'android';

const CH_ALERTS = 'health-alerts';
const CH_REMINDERS = 'reminders';

const ID = {
  lowRecheck: 'gv-recheck-low',
  highRecheck: 'gv-recheck-high',
  postMeal: 'gv-post-meal',
  lowTimer: 'gv-low-timer',
};

const KEY_REMINDERS = 'gv.reminders.v1';
const KEY_LAST_RISK_ALERT = 'gv.lastRiskAlert';
const KEY_SMART = 'gv.smartAlerts.v1';

// Smart health alerts can be switched off in Reminders (default: on).
export async function smartAlertsEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_SMART)) !== 'off';
  } catch {
    return true;
  }
}

export async function setSmartAlerts(on: boolean) {
  try {
    await AsyncStorage.setItem(KEY_SMART, on ? 'on' : 'off');
  } catch {}
  if (!on && ENABLED) {
    for (const id of [ID.lowRecheck, ID.highRecheck, ID.postMeal]) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }
}

// A test notification a few seconds from now (Reminders screen).
export async function sendTestNotification(): Promise<boolean> {
  if (!ENABLED) return false;
  if (!(await ensurePermission())) return false;
  await notify(
    { title: 'GlycoVision notifications are on', body: "This is how your reminders and alerts will look.", url: '/', kind: 'info' },
    inSeconds(3),
  );
  return true;
}

// ---------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------

let configured = false;

export function configureNotifications() {
  if (!ENABLED || configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    Notifications.addNotificationReceivedListener(recordDelivered);
    syncDelivered();
    AppState.addEventListener('change', (s) => {
      if (s === 'active') syncDelivered();
    });
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(CH_ALERTS, {
        name: 'Health alerts',
        description: 'Low and high blood sugar alerts and rechecks',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#E0393B',
      }).catch(() => {});
      Notifications.setNotificationChannelAsync(CH_REMINDERS, {
        name: 'Reminders',
        description: 'Daily sugar checks and medicine reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      }).catch(() => {});
    }
  } catch (e) {
    console.log('[notifications] setup failed', e);
  }
}

// Ask once, when the user turns on a reminder or the first alert is due.
export async function ensurePermission(): Promise<boolean> {
  if (!ENABLED) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (!ENABLED) return 'unsupported';
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

async function notify(
  content: { title: string; body: string; url: string; kind: InboxKind; alert?: boolean },
  trigger: Notifications.NotificationTriggerInput,
  identifier?: string,
) {
  // Immediate alerts go to the in-app bell right away, even on web or when
  // phone notifications are blocked. Scheduled ones are recorded when they
  // arrive (see recordDelivered).
  const immediate = trigger == null || !('type' in (trigger as object));
  if (immediate) {
    await addInboxItem({ kind: content.kind, title: content.title, body: content.body, url: content.url });
  }
  if (!ENABLED) return;
  try {
    if (!(await ensurePermission())) return;
    if (identifier) await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: content.title,
        body: content.body,
        data: { url: content.url, kind: content.kind, inbox: immediate ? 'recorded' : 'pending' },
        sound: true,
        priority: content.alert ? Notifications.AndroidNotificationPriority.MAX : undefined,
      },
      trigger:
        trigger && Platform.OS === 'android' && 'type' in (trigger as object)
          ? ({ ...(trigger as object), channelId: content.alert ? CH_ALERTS : CH_REMINDERS } as Notifications.NotificationTriggerInput)
          : trigger,
    });
  } catch (e) {
    console.log('[notifications] schedule failed', e);
  }
}

const inSeconds = (seconds: number): Notifications.NotificationTriggerInput => ({
  type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
  seconds,
});

const now = (): Notifications.NotificationTriggerInput =>
  Platform.OS === 'android'
    ? ({ channelId: CH_ALERTS } as Notifications.NotificationTriggerInput)
    : null;

async function cancel(id: string) {
  if (!ENABLED) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}

// A scheduled notification reached the phone: add it to the bell inbox
// once (its identifier + delivery time make the inbox id).
function recordDelivered(n: Notifications.Notification) {
  const data = (n.request.content.data ?? {}) as { url?: string; kind?: InboxKind; inbox?: string };
  if (data.inbox === 'recorded') return; // immediate alerts are already in
  addInboxItem({
    id: `${n.request.identifier}@${n.date}`,
    kind: data.kind ?? 'reminder',
    title: n.request.content.title ?? 'GlycoVision',
    body: n.request.content.body ?? '',
    url: typeof data.url === 'string' ? data.url : '/',
    createdAt: new Date(n.date).toISOString(),
  }).catch(() => {});
}

// Notifications delivered while the app was closed are still in the
// phone's tray: copy them into the inbox when the app opens or returns.
async function syncDelivered() {
  if (!ENABLED) return;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    shown.forEach(recordDelivered);
  } catch {}
}

// ---------------------------------------------------------------------
// Smart health alerts
// ---------------------------------------------------------------------

export async function onBloodSugarLogged(value: number) {
  if (!Number.isFinite(value) || !(await smartAlertsEnabled())) return;

  if (value < 70) {
    const veryLow = value < 54;
    await notify(
      {
        title: veryLow ? `Very low sugar: ${value} mg/dL` : `Low sugar: ${value} mg/dL`,
        body: 'Take 15 g of fast sugar now (juice, glucose tablets or 3 tsp sugar). Tap for help.',
        url: '/low-help',
        kind: 'low',
        alert: true,
      },
      now(),
    );
    await notify(
      {
        title: 'Recheck your sugar now',
        body: "It's been 15 minutes since your low reading. Check again and log it.",
        url: '/?logBg=1',
        kind: 'low',
        alert: true,
      },
      inSeconds(15 * 60),
      ID.lowRecheck,
    );
    return;
  }

  // Back in a safe range: the pending low recheck is no longer needed.
  await cancel(ID.lowRecheck);

  if (value > 250) {
    await notify(
      {
        title: 'High sugar recheck',
        body: `Your reading was ${value} mg/dL two hours ago. Check again and follow your care plan.`,
        url: '/?logBg=1',
        kind: 'high',
        alert: true,
      },
      inSeconds(2 * 60 * 60),
      ID.highRecheck,
    );
  } else {
    await cancel(ID.highRecheck);
  }
}

export async function onMealLogged(foodName: string) {
  if (!ENABLED || !(await smartAlertsEnabled())) return;
  await notify(
    {
      title: 'After-meal sugar check',
      body: `Two hours since ${foodName}. A quick reading shows how this meal affects you.`,
      url: '/?logBg=1',
      kind: 'meal',
    },
    inSeconds(2 * 60 * 60),
    ID.postMeal,
  );
}

// At most one alert every 2 hours, so it never nags.
export async function onSpikeRisk(level: string | undefined, percent: number | undefined) {
  if (level !== 'elevated' || !(await smartAlertsEnabled())) return;
  try {
    const last = Number(await AsyncStorage.getItem(KEY_LAST_RISK_ALERT)) || 0;
    if (Date.now() - last < 2 * 60 * 60 * 1000) return;
    await AsyncStorage.setItem(KEY_LAST_RISK_ALERT, String(Date.now()));
  } catch {
    return;
  }
  await notify(
    {
      title: 'Sugar may rise soon',
      body: `${percent ?? 'High'}% chance of a rise in the next hour. Open GlycoVision to see what to do.`,
      url: '/',
      kind: 'risk',
      alert: true,
    },
    now(),
  );
}

// Low sugar help: 15-minute timer finished.
export async function startLowTimerAlert(seconds = 15 * 60) {
  await notify(
    {
      title: '15 minutes are up',
      body: 'Check your sugar again. If still below 70, take another 15 g of fast sugar.',
      url: '/?logBg=1',
      kind: 'timer',
      alert: true,
    },
    inSeconds(seconds),
    ID.lowTimer,
  );
}

export async function cancelLowTimerAlert() {
  if (!ENABLED) return;
  await Notifications.cancelScheduledNotificationAsync(ID.lowTimer).catch(() => {});
}

// ---------------------------------------------------------------------
// Daily reminders
// ---------------------------------------------------------------------

export type ReminderKey = 'fasting' | 'bedtime' | 'insulin_morning' | 'insulin_evening';

export type Reminder = { enabled: boolean; hour: number; minute: number };
export type Reminders = Record<ReminderKey, Reminder>;

export const REMINDER_INFO: Record<ReminderKey, { title: string; body: string; label: string; url: string }> = {
  fasting: {
    label: 'Morning fasting check',
    title: 'Good morning! Fasting sugar check',
    body: 'Check your sugar before breakfast and log it.',
    url: '/?logBg=1',
  },
  bedtime: {
    label: 'Bedtime check',
    title: 'Bedtime sugar check',
    body: 'A reading before sleep helps avoid lows at night.',
    url: '/?logBg=1',
  },
  insulin_morning: {
    label: 'Morning insulin / medicine',
    title: 'Morning insulin / medicine',
    body: 'Time for your morning dose, as your doctor prescribed.',
    url: '/bolus',
  },
  insulin_evening: {
    label: 'Evening insulin / medicine',
    title: 'Evening insulin / medicine',
    body: 'Time for your evening dose, as your doctor prescribed.',
    url: '/bolus',
  },
};

export const DEFAULT_REMINDERS: Reminders = {
  fasting: { enabled: false, hour: 8, minute: 0 },
  bedtime: { enabled: false, hour: 22, minute: 30 },
  insulin_morning: { enabled: false, hour: 8, minute: 30 },
  insulin_evening: { enabled: false, hour: 20, minute: 0 },
};

export async function loadReminders(): Promise<Reminders> {
  try {
    const raw = await AsyncStorage.getItem(KEY_REMINDERS);
    return raw ? { ...DEFAULT_REMINDERS, ...JSON.parse(raw) } : DEFAULT_REMINDERS;
  } catch {
    return DEFAULT_REMINDERS;
  }
}

// Saves and re-schedules every daily reminder. Returns false if the user
// has blocked notifications (reminders are saved but cannot fire).
export async function saveReminders(r: Reminders): Promise<boolean> {
  try {
    await AsyncStorage.setItem(KEY_REMINDERS, JSON.stringify(r));
  } catch {}
  if (!ENABLED) return true;
  const anyOn = Object.values(r).some((x) => x.enabled);
  const allowed = anyOn ? await ensurePermission() : true;
  for (const key of Object.keys(REMINDER_INFO) as ReminderKey[]) {
    const id = `gv-daily-${key}`;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    if (r[key].enabled && allowed) {
      const info = REMINDER_INFO[key];
      await notify(
        { title: info.title, body: info.body, url: info.url, kind: 'reminder' },
        {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: r[key].hour,
          minute: r[key].minute,
        },
        id,
      );
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------
// Tap handling
// ---------------------------------------------------------------------

// Calls `open(url)` when the user taps a notification (also for the tap
// that launched the app). Returns an unsubscribe function.
export function listenForTaps(open: (url: string) => void): () => void {
  if (!ENABLED) return () => {};
  try {
    // The tap that launched the app (if any); cleared so a reload does not
    // open the same screen again.
    const launch = Notifications.getLastNotificationResponse();
    const url = launch?.notification.request.content.data?.url;
    if (typeof url === 'string') {
      Notifications.clearLastNotificationResponse();
      setTimeout(() => open(url), 300);
    }
  } catch {}
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const url = res.notification.request.content.data?.url;
    if (typeof url === 'string') open(url);
  });
  return () => sub.remove();
}
