// lib/notifications.ts + lib/inbox.ts with expo-notifications mocked:
// which alerts fire, which reminders get scheduled or cancelled, and
// what reaches the bell.

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getPresentedNotificationsAsync: jest.fn(() => Promise.resolve([])),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidNotificationPriority: { MAX: 'max' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DAILY: 'daily' },
}));

// Fresh module state (inbox cache, configured flag) for every test. After
// resetModules the code gets new mock instances, so re-read them here.
let AsyncStorage: any;
let schedule: jest.Mock;
let cancel: jest.Mock;
let perms: jest.Mock;
let notif: typeof import('@/lib/notifications');
let inbox: typeof import('@/lib/inbox');
beforeEach(async () => {
  jest.resetModules();
  const N = require('expo-notifications');
  AsyncStorage = require('@react-native-async-storage/async-storage');
  schedule = N.scheduleNotificationAsync;
  cancel = N.cancelScheduledNotificationAsync;
  perms = N.getPermissionsAsync;
  schedule.mockClear();
  cancel.mockClear();
  await AsyncStorage.clear();
  perms.mockResolvedValue({ granted: true, canAskAgain: true });
  notif = require('@/lib/notifications');
  inbox = require('@/lib/inbox');
});

const scheduledIds = () => schedule.mock.calls.map((c) => c[0].identifier).filter(Boolean);
const scheduledTitles = () => schedule.mock.calls.map((c) => c[0].content.title);
const items = () => new Promise<any[]>((res) => { const off = inbox.subscribeInbox((x) => { off(); res(x); }); });

describe('smart alerts from a reading', () => {
  test('low reading: alert now + recheck in 15 min', async () => {
    await notif.onBloodSugarLogged(62);
    expect(scheduledTitles()[0]).toMatch(/Low sugar: 62/);
    const recheck = schedule.mock.calls.find((c) => c[0].identifier === 'gv-recheck-low')[0];
    expect(recheck.trigger.seconds).toBe(15 * 60);
  });

  test('very low wording below 54', async () => {
    await notif.onBloodSugarLogged(48);
    expect(scheduledTitles()[0]).toMatch(/Very low/);
  });

  test('normal reading cancels a pending low recheck and schedules nothing', async () => {
    await notif.onBloodSugarLogged(110);
    expect(cancel).toHaveBeenCalledWith('gv-recheck-low');
    expect(schedule).not.toHaveBeenCalled();
  });

  test('very high reading: recheck in 2 h', async () => {
    await notif.onBloodSugarLogged(280);
    const c = schedule.mock.calls.find((x) => x[0].identifier === 'gv-recheck-high')[0];
    expect(c.trigger.seconds).toBe(7200);
  });

  test('boundary 70 is not low, 250 is not very high', async () => {
    await notif.onBloodSugarLogged(70);
    await notif.onBloodSugarLogged(250);
    expect(schedule).not.toHaveBeenCalled();
  });

  test('switched off: nothing fires', async () => {
    await notif.setSmartAlerts(false);
    await notif.onBloodSugarLogged(50);
    await notif.onMealLogged('Biryani');
    expect(schedule).not.toHaveBeenCalled();
  });

  test('NaN reading is ignored', async () => {
    await notif.onBloodSugarLogged(NaN);
    expect(schedule).not.toHaveBeenCalled();
  });

  test('blocked permission: no schedule, but the bell still gets the low alert', async () => {
    perms.mockResolvedValue({ granted: false, canAskAgain: false });
    await notif.onBloodSugarLogged(60);
    expect(schedule).not.toHaveBeenCalled();
    expect((await items()).some((i) => i.kind === 'low')).toBe(true);
  });
});

describe('meal and risk', () => {
  test('meal schedules one 2-hour check, replacing the previous', async () => {
    await notif.onMealLogged('Biryani');
    await notif.onMealLogged('Chai');
    expect(cancel).toHaveBeenCalledWith('gv-post-meal');
    const last = schedule.mock.calls[schedule.mock.calls.length - 1][0];
    expect(last.identifier).toBe('gv-post-meal');
    expect(last.content.body).toMatch(/Chai/);
  });

  test('rise risk alerts once, then is rate-limited for 2 h', async () => {
    await notif.onSpikeRisk('elevated', 71);
    await notif.onSpikeRisk('elevated', 75);
    expect(scheduledTitles().filter((t) => /rise soon/.test(t))).toHaveLength(1);
  });

  test('moderate risk does not alert', async () => {
    await notif.onSpikeRisk('moderate', 40);
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe('daily reminders', () => {
  test('enabled reminders are scheduled daily at the chosen time; disabled are cancelled', async () => {
    const r = { ...notif.DEFAULT_REMINDERS, fasting: { enabled: true, hour: 7, minute: 45 } };
    await notif.saveReminders(r);
    const c = schedule.mock.calls.find((x) => x[0].identifier === 'gv-daily-fasting')[0];
    expect(c.trigger).toMatchObject({ type: 'daily', hour: 7, minute: 45 });
    expect(scheduledIds()).not.toContain('gv-daily-bedtime');
    expect(cancel).toHaveBeenCalledWith('gv-daily-bedtime');
  });

  test('saved reminders survive a restart', async () => {
    const r = { ...notif.DEFAULT_REMINDERS, bedtime: { enabled: true, hour: 23, minute: 0 } };
    await notif.saveReminders(r);
    // loadReminders reads phone storage on every call (no in-memory cache).
    expect((await notif.loadReminders()).bedtime).toEqual({ enabled: true, hour: 23, minute: 0 });
    expect(JSON.parse(await AsyncStorage.getItem('gv.reminders.v1')).bedtime.enabled).toBe(true);
  });

  test('corrupted storage falls back to defaults', async () => {
    await AsyncStorage.setItem('gv.reminders.v1', '{not json');
    expect(await notif.loadReminders()).toEqual(notif.DEFAULT_REMINDERS);
  });
});

describe('inbox (bell)', () => {
  test('first run shows one welcome item', async () => {
    const list = await items();
    expect(list).toHaveLength(1);
    expect(inbox.unreadCount(list)).toBe(1);
  });

  test('add / mark read / mark all / clear', async () => {
    await inbox.addInboxItem({ kind: 'low', title: 'Low', body: 'b', url: '/low-help' });
    let list = await items();
    expect(list[0].title).toBe('Low');
    await inbox.markRead(list[0].id);
    list = await items();
    expect(list[0].read).toBe(true);
    await inbox.markAllRead();
    expect(inbox.unreadCount(await items())).toBe(0);
    await inbox.clearInbox();
    expect(await items()).toHaveLength(0);
  });

  test('same id is recorded once (no duplicates from tray sync)', async () => {
    await inbox.addInboxItem({ id: 'x@1', kind: 'reminder', title: 'A', body: '', url: '/' });
    await inbox.addInboxItem({ id: 'x@1', kind: 'reminder', title: 'A', body: '', url: '/' });
    expect((await items()).filter((i) => i.id === 'x@1')).toHaveLength(1);
  });

  test('keeps at most 60 items', async () => {
    for (let i = 0; i < 75; i++) await inbox.addInboxItem({ kind: 'info', title: `n${i}`, body: '', url: '/' });
    const list = await items();
    expect(list).toHaveLength(60);
    expect(list[0].title).toBe('n74');
  });

  test('corrupted inbox storage does not crash', async () => {
    await AsyncStorage.setItem('gv.inbox.v1', 'garbage');
    jest.resetModules();
    const fresh = require('@/lib/inbox');
    await expect(fresh.loadInbox()).resolves.toBeUndefined();
  });
});
