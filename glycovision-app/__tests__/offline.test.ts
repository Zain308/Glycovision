/// <reference types="jest" />
// Without internet: entries are kept, uploaded once, and never mixed between
// accounts; old forecasts and doses are never shown.

jest.mock('@/lib/supabase', () => {
  const session = { access_token: 'tok', refresh_token: 'r', user: { id: 'u1' } };
  return {
    storedSession: jest.fn(() => Promise.resolve(session)),
    supabase: { auth: { getSession: jest.fn(() => Promise.resolve({ data: { session }, error: null })) } },
  };
});
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@/lib/config', () => ({ API_URL: 'http://test' }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { storedSession, supabase } from '@/lib/supabase';
import { closeOutbox, flush, forgetCopies, isOffline, newId, offlineState, openOutbox, removeProblem, setConnection, type Entry, type OfflineState } from '@/lib/offline';
import { doseState, entryName, localDay, withMedicines, withReadings, withSummary, withTimeline } from '@/lib/offlineView';
import { bannerMessage } from '@/components/OfflineBanner';
import { parseUnits } from '@/components/RecordDose';
import { calculateIntervention, deleteEntry, getBgHistory, getTimelineToday, getCarePlan, getCurrentIob, getDashboardSummary, getFitness, getMedicines, logBg, logBolus, logMeal, logMedicine } from '@/services/api';

const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: jest.Mock;
const sent = () => fetchMock.mock.calls.filter((c) => c[1].method === 'POST').map((c) => ({ url: String(c[0]), body: JSON.parse(c[1].body) }));
const noNet = () => fetchMock.mockRejectedValue(new TypeError('Network request failed'));

beforeEach(async () => {
  await AsyncStorage.clear();
  closeOutbox();
  fetchMock = jest.fn(() => res({ status: 'logged' }));
  (globalThis as any).fetch = fetchMock;
  setConnection(true);
  (storedSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, refresh_token: 'r' });
});

describe('logging', () => {
  test('online: sent at once with an id and no age, nothing left behind', async () => {
    expect(await logBg(120)).toEqual({ status: 'logged' });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(sent()[0].body.age_seconds).toBeUndefined();
    expect(offlineState().waiting).toEqual([]);
  });

  test('no connection: kept on the phone, then uploaded with the same id and its age', async () => {
    setConnection(false);
    expect(await logBolus({ dose_units: 4 })).toEqual({ status: 'queued' });
    expect(fetchMock).not.toHaveBeenCalled();
    const id = offlineState().waiting[0].id;
    expect(JSON.parse((await AsyncStorage.getItem('gv.outbox.u1'))!).waiting).toHaveLength(1);
    setConnection(true);
    await flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body).toMatchObject({ dose_units: 4, client_id: id });
    expect(sent()[0].body.age_seconds).toBeGreaterThanOrEqual(0);
    expect(offlineState().waiting).toEqual([]);
  });

  test('made offline hours ago: the age says so, even on the first try', async () => {
    setConnection(false);
    const t = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(t);
    await logMeal({ food_name: 'Roti', carbs: 30 });
    clock.mockReturnValue(t + 3 * 3600_000);
    setConnection(true);
    await flush();
    clock.mockRestore();
    expect(sent()[0].body.age_seconds).toBe(3 * 3600);
  });

  test('lost answer: the second try repeats the same id', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await logBg(99)).status).toBe('queued');
    fetchMock.mockImplementation(() => res({ status: 'logged' }));
    await flush();
    const [a, b] = sent();
    expect(a.body.client_id).toBe(b.body.client_id);
    expect(a.body.age_seconds).toBeUndefined();
    expect(b.body.age_seconds).toBeDefined();
  });

  test('closing the app keeps what is waiting', async () => {
    setConnection(false);
    await logBg(150);
    closeOutbox();
    expect(offlineState().waiting).toEqual([]);
    await openOutbox('u1');
    expect(offlineState().waiting.map((e) => e.body.value)).toEqual([150]);
  });

  test('app killed before the first try: the old entry still sends its age', async () => {
    const entry = { id: newId(), kind: 'bolus', path: '/log-bolus', body: { dose_units: 4 }, at: Date.now() - 5 * 3600_000, tries: 0 };
    await AsyncStorage.setItem('gv.outbox.u1', JSON.stringify({ waiting: [entry], problems: [] }));
    await openOutbox('u1');
    await flush();
    expect(sent()[0].body.age_seconds).toBeGreaterThanOrEqual(5 * 3600);
  });

  test('oldest first, and a dead connection stops after one try', async () => {
    setConnection(false);
    await logBg(100);
    await logBg(110);
    setConnection(true);
    await flush();
    expect(sent().map((s) => s.body.value)).toEqual([100, 110]);
    setConnection(false);
    await logBg(120);
    await logBg(130);
    fetchMock.mockClear();
    noNet();
    setConnection(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(offlineState().waiting).toHaveLength(2);
  });

  test('a busy server keeps the entry but does not hold up the others', async () => {
    setConnection(false);
    await logBg(100);
    await logMeal({ food_name: 'Daal', carbs: 20 });
    fetchMock.mockImplementation((u: string) => (u.includes('log-bg') ? res({ detail: 'x' }, 503) : res({ status: 'logged' })));
    setConnection(true);
    await flush();
    expect(offlineState().waiting.map((e) => e.kind)).toEqual(['bg']);
  });

  test('refused while the form is open: the form gets the reason', async () => {
    fetchMock.mockImplementation(() => res({ detail: 'Too high' }, 422));
    await expect(logBg(150)).rejects.toThrow('Too high');
    expect(offlineState().waiting).toEqual([]);
    expect(offlineState().problems).toEqual([]);
  });

  test('refused later: shown with its reason, never silently lost', async () => {
    setConnection(false);
    await logBg(150);
    fetchMock.mockImplementation(() => res({ detail: 'Too old' }, 422));
    setConnection(true);
    await flush();
    expect(offlineState().waiting).toEqual([]);
    const [p] = offlineState().problems;
    expect(p.problem).toBe('Too old');
    await removeProblem(p.id);
    expect(offlineState().problems).toEqual([]);
  });

  test('a full phone tells the user instead of pretending', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('full'));
    await expect(logBg(150)).rejects.toThrow(/Free some space/);
    expect(offlineState().waiting).toEqual([]);
  });

  test('another account never sends these entries', async () => {
    setConnection(false);
    await logBolus({ dose_units: 4 });
    (storedSession as jest.Mock).mockResolvedValue({ user: { id: 'u2' }, refresh_token: 'r' });
    setConnection(true);
    await flush();
    expect(sent()).toEqual([]);
    await openOutbox('u2');
    expect(offlineState().waiting).toEqual([]);
    (storedSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' }, refresh_token: 'r' });
    await openOutbox('u1');
    expect(offlineState().waiting).toHaveLength(1);
  });

  test('taken, then undone, offline: only the last counts', async () => {
    setConnection(false);
    await logMedicine(7, '2026-11-24', '08:00', 'taken');
    await logMedicine(7, '2026-11-24', '08:00', null);
    expect(offlineState().waiting.map((e) => e.body.status)).toEqual([null]);
    await logMedicine(7, '2026-11-24', '20:00', 'taken');
    expect(offlineState().waiting).toHaveLength(2);
  });

  test('ids are unique', () => {
    expect(new Set(Array.from({ length: 2000 }, newId)).size).toBe(2000);
  });
});

describe('deleting a wrong entry', () => {
  test('one still on the phone is never uploaded', async () => {
    fetchMock.mockImplementation(() => res({ events: [] }));
    await getTimelineToday();
    setConnection(false);
    await logBolus({ dose_units: 40 });
    const [e] = await getTimelineToday();
    expect(e.id).toMatch(/^local:/);
    await deleteEntry(e);
    setConnection(true);
    await flush();
    expect(sent()).toEqual([]);
  });
  test('one on the server is deleted there', async () => {
    await deleteEntry({ id: 7, type: 'bg', title: '140', detail: '', logged_at: '' });
    const [url, init] = fetchMock.mock.calls[0];
    expect([String(url).endsWith('/api/v1/entries/bg/7'), init.method]).toEqual([true, 'DELETE']);
  });
});

describe('safety', () => {
  const state = { current_bg: 150, target_bg: 110, isf: 50, iob: 0, total_carbs: 30, icr: 10 };

  test('no dose, forecast or active insulin while insulin is only on the phone', async () => {
    setConnection(false);
    await logBolus({ dose_units: 4 });
    fetchMock.mockImplementation((u: string) => (u.includes('log-bolus') ? res({}, 503) : res({ iob: 0 })));
    setConnection(true);
    for (const ask of [() => calculateIntervention(state), () => getCurrentIob(), () => getCarePlan()]) {
      await expect(ask()).rejects.toThrow(/not uploaded yet/);
    }
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('log-bolus'))).toBe(true);
  });

  test('also right after the app starts, before the outbox was opened', async () => {
    setConnection(false);
    await logBolus({ dose_units: 4 });
    closeOutbox();
    fetchMock.mockImplementation((u: string) => (u.includes('log-bolus') ? res({}, 503) : res({ iob: 0 })));
    setConnection(true);
    await expect(getCurrentIob()).rejects.toThrow(/not uploaded yet/);
  });

  test('waiting insulin is uploaded before the dose is asked for', async () => {
    setConnection(false);
    await logBolus({ dose_units: 4 });
    setConnection(true);
    await calculateIntervention(state);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]).split('/').pop());
    expect(urls).toEqual(['log-bolus', 'calculate-intervention']);
  });

  test('a plan, dose or active insulin is never kept for later', async () => {
    fetchMock.mockImplementation(() => res({ iob: 1, insulin: { units: 5 } }));
    await getCarePlan();
    await getCurrentIob();
    await calculateIntervention(state);
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('gv.cache.'))).toEqual([]);
    setConnection(false);
    await expect(getCarePlan()).rejects.toMatchObject({ offline: true });
    await expect(getCurrentIob()).rejects.toMatchObject({ offline: true });
  });

  test('an expired login without internet counts as offline, not signed out', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'x' } });
    await expect(getCurrentIob()).rejects.toMatchObject({ offline: true });
    expect(isOffline(new Error('x'))).toBe(false);
  });
});

describe('saved copies', () => {
  test('the last readings show offline, with new ones added', async () => {
    fetchMock.mockImplementation(() => res({ window_hours: 24, count: 1, readings: [{ id: 1, value: 110, logged_at: new Date(Date.now() - 3600_000).toISOString() }] }));
    await getBgHistory(24);
    setConnection(false);
    await logBg(140);
    const h = await getBgHistory(24);
    expect(h.readings.map((r) => r.value)).toEqual([110, 140]);
    expect(offlineState().savedAt).not.toBeNull();
  });

  test('nothing saved: a clear error', async () => {
    setConnection(false);
    await expect(getDashboardSummary()).rejects.toThrow(/internet/);
  });

  test('a server error is not hidden behind a copy', async () => {
    fetchMock.mockImplementation(() => res({ readings: [] }));
    await getBgHistory(24);
    fetchMock.mockImplementation(() => res({ detail: 'boom' }, 500));
    await expect(getBgHistory(24)).rejects.toThrow(/boom/);
  });

  test('a hanging connection shows the copy within seconds', async () => {
    fetchMock.mockImplementation(() => res({ readings: [{ id: 1, value: 110, logged_at: new Date().toISOString() }] }));
    await getBgHistory(24);
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const p = getBgHistory(24);
    await jest.advanceTimersByTimeAsync(4100);
    expect((await p).readings).toHaveLength(1);
    expect(offlineState().savedAt).not.toBeNull();
    jest.useRealTimers();
  });

  test('yesterday is never shown as today', async () => {
    fetchMock.mockImplementation(() => res({ today: { steps: 9000 } }));
    await getFitness();
    setConnection(false);
    expect((await getFitness()).today.steps).toBe(9000);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 3600_000);
    await expect(getFitness()).rejects.toMatchObject({ offline: true });
    clock.mockRestore();
  });

  test('medicines can be ticked offline', async () => {
    const day = localDay(Date.now());
    fetchMock.mockImplementation(() => res({ medicines: [{ id: 7, name: 'Metformin', dose: null, times: ['08:00'], note: null }], today: [], adherence: { taken: 0, planned: 0, percent: null, days: 7 }, day }));
    await getMedicines();
    setConnection(false);
    await logMedicine(7, day, '08:00', 'taken');
    expect((await getMedicines()).today).toMatchObject([{ medicine_id: 7, time: '08:00', state: 'taken' }]);
  });

  test('signing out removes copies but keeps what was not uploaded', async () => {
    fetchMock.mockImplementation(() => res({ readings: [] }));
    await getBgHistory(24);
    setConnection(false);
    await logBg(100);
    await forgetCopies('u1');
    expect(await AsyncStorage.getAllKeys()).toEqual(['gv.outbox.u1']);
  });
});

describe('putting entries into the copies', () => {
  const now = new Date(2026, 10, 24, 12, 0).getTime();
  const e = (kind: Entry['kind'], body: any, at = now): Entry => ({ id: `${kind}${at}`, kind, path: '', body, at, tries: 1 });
  const summary = { full_name: 'A', diabetes_type: 'Type 1', total_carbs_today: 30, total_insulin_today: 2, meals_logged_today: 1, latest_bg: 120, time_in_range_pct: 100, bg_readings_today: 1 };

  test('totals', () => {
    const r = withSummary(summary, now, [e('meal', { carbs: 20.5 }), e('bolus', { dose_units: 3 }), e('bg', { value: 200 })], now);
    expect(r).toMatchObject({ total_carbs_today: 50.5, total_insulin_today: 5, meals_logged_today: 2, latest_bg: 200, time_in_range_pct: 50, bg_readings_today: 2 });
  });
  test('a new day starts from zero', () => {
    const r = withSummary(summary, now - 24 * 3600_000, [e('bolus', { dose_units: 9 }, now - 24 * 3600_000)], now);
    expect(r).toMatchObject({ total_carbs_today: 0, total_insulin_today: 0, latest_bg: null, time_in_range_pct: null });
  });
  test('timeline is newest first and marks what waits', () => {
    const old = { type: 'meal' as const, title: 'Chai', detail: '', logged_at: new Date(now - 3600_000).toISOString() };
    const r = withTimeline([old], now, [e('bolus', { dose_units: 4 }), e('vital', { kind: 'weight' })], now);
    expect(r.map((x) => x.title)).toEqual(['4 u insulin', 'Chai']);
    expect(r[0].detail).toContain('this phone');
    expect(withTimeline([old], now - 24 * 3600_000, [], now)).toEqual([]);
  });
  test('old readings leave the window', () => {
    expect(withReadings([{ value: 1, logged_at: new Date(now - 25 * 3600_000).toISOString() }], [e('bg', { value: 90 })], 24, now).map((r) => r.value)).toEqual([90]);
  });
  test('medicine states follow the clock and the day', () => {
    expect([doseState('12:30', 720, null), doseState('12:31', 720, null), doseState('09:59', 720, null), doseState('10:00', 720, null)]).toEqual(['due', 'later', 'missed', 'due']);
    const m = { id: 1, name: 'A', dose: null, times: ['12:00'], note: null };
    const copy = { medicines: [m], today: [{ medicine_id: 1, name: 'A', dose: null, time: '12:00', state: 'taken' as const }], adherence: { taken: 0, planned: 0, percent: null, days: 7 }, day: '2026-11-24' };
    expect(withMedicines(copy, [], now).today[0].state).toBe('taken');
    expect(withMedicines({ ...copy, day: '2026-11-23' }, [], now).today[0].state).toBe('due');
    expect(withMedicines(copy, [e('medicine', { medicine_id: 1, day: '2026-11-24', time: '12:00', status: null })], now).today[0].state).toBe('due');
  });
  test('every kind has a name', () => {
    expect(entryName(e('bolus', { dose_units: 4 }))).toBe('Insulin 4 units');
    expect(entryName(e('vital', { kind: 'hba1c' }))).toBe('HbA1c');
    expect(entryName(e('medicine', { status: null, time: '08:00' }))).toContain('undone');
  });
});

describe('small parts', () => {
  const s = (x: Partial<OfflineState>): OfflineState => ({ offline: false, waiting: [], problems: [], savedAt: null, ...x });
  const w = (tries: number) => [{ id: 'a', kind: 'bg', path: '', body: {}, at: 0, tries } as Entry];
  test('banner words', () => {
    expect(bannerMessage(s({}), s({ offline: true }))?.text).toContain('keep logging');
    expect(bannerMessage(s({ offline: true }), s({ offline: true, waiting: w(0) }))?.text).toContain('Saved on your phone');
    expect(bannerMessage(s({ offline: true }), s({}))?.text).toBe('Back online');
    expect(bannerMessage(s({ waiting: w(2) }), s({}))?.text).toContain('uploaded');
    expect(bannerMessage(s({ waiting: w(1) }), s({}))).toBeNull();
  });
  test('units', () => {
    expect(parseUnits('4,5')).toBe(4.5);
    for (const bad of ['', '0', '-2', 'x', '51']) expect(typeof parseUnits(bad)).toBe('string');
  });
});
