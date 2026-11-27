// lib/offline.ts
//
// GlycoVision without internet.
//   Outbox: everything logged is written to the phone first, then uploaded.
//           Each entry has an id, so the server never stores it twice, and its
//           age, so it keeps the time it was really made.
//   Copies: the last answer of each screen, shown when there is no internet.
//           Forecasts and insulin doses are never kept: an old one is unsafe.
//   State:  one small store the banner, Home and Your data listen to.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type EntryKind = 'bg' | 'meal' | 'bolus' | 'activity' | 'vital' | 'medicine';

export interface Entry {
  id: string;
  kind: EntryKind;
  path: string;
  body: Record<string, any>;
  at: number;
  tries: number;
  /** Only the newest entry of a group counts, like taken then undone. */
  group?: string;
  /** Why the server refused it. */
  problem?: string;
  /** Why the server asked to try later, in its own words. */
  note?: string;
}

export interface OfflineState {
  offline: boolean;
  waiting: Entry[];
  problems: Entry[];
  /** When the copy on screen was made; null while data is live. */
  savedAt: number | null;
}

export type UploadResult = { type: 'ok'; data: any } | { type: 'no_internet' } | { type: 'later'; message?: string } | { type: 'refused'; message: string };
type Uploader = (entry: Entry, ageSeconds: number | null, uid: string) => Promise<UploadResult>;

// ------------------------------------------------------------- state

let state: OfflineState = { offline: false, waiting: [], problems: [], savedAt: null };
const listeners = new Set<() => void>();

function set(next: Partial<OfflineState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const offlineState = () => state;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const useOffline = () => useSyncExternalStore(subscribe, offlineState, offlineState);

/** The phone itself says there is no connection (NetInfo). */
let disconnected = false;
export const isDisconnected = () => disconnected;

export function setConnection(connected: boolean) {
  disconnected = !connected;
  if (!connected) set({ offline: true });
  else {
    if (state.offline) set({ offline: false });
    flush().catch(() => {});
  }
}

/** The server answered, or could not be reached. */
export function reached(ok: boolean) {
  const offline = !ok || disconnected;
  if (offline !== state.offline) set({ offline });
  if (ok && state.savedAt != null) set({ savedAt: null });
}

export class OfflineError extends Error {
  offline = true;
  constructor(message = "Couldn't reach GlycoVision. Check your internet connection and try again.") {
    super(message);
    this.name = 'OfflineError';
  }
}
export const isOffline = (e: unknown): boolean => !!(e as { offline?: boolean })?.offline;

// ------------------------------------------------------------- outbox

const outboxKey = (uid: string) => `gv.outbox.${uid}`;
/** An entry this fresh is simply "now". */
const FRESH_MS = 10_000;
/** How long a form waits for the server before it says "saved on your phone". */
const WAIT_MS = 6_000;
const WAIT_OFFLINE_MS = 1_500;
const MAX_PROBLEMS = 30;
/** Entries that change the forecast or a dose. */
const MATTERS: EntryKind[] = ['bg', 'meal', 'bolus', 'activity'];

let owner: string | null = null;
let opening: Promise<void> | null = null;
let uploader: Uploader | null = null;
let inFlight: string | null = null;
const results = new Map<string, UploadResult | null>();

export const setUploader = (u: Uploader) => {
  uploader = u;
};

export function newId(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let writing: Promise<void> = Promise.resolve();
function persist(): Promise<void> {
  const uid = owner;
  if (!uid) return Promise.resolve();
  const text = JSON.stringify({ waiting: state.waiting, problems: state.problems });
  const job = writing.catch(() => {}).then(() => AsyncStorage.setItem(outboxKey(uid), text));
  writing = job;
  return job;
}

/** Load this account's outbox. Another account's entries stay untouched. */
export function openOutbox(uid: string): Promise<void> {
  if (owner === uid && opening) return opening;
  owner = uid;
  set({ waiting: [], problems: [], savedAt: null });
  opening = (async () => {
    const raw = await AsyncStorage.getItem(outboxKey(uid)).catch(() => null);
    if (owner !== uid || !raw) return;
    try {
      const saved = JSON.parse(raw);
      set({ waiting: saved.waiting ?? [], problems: saved.problems ?? [] });
    } catch (e) {
      console.log('[offline] outbox unreadable', e);
    }
  })();
  return opening;
}

export function closeOutbox() {
  owner = null;
  opening = null;
  set({ waiting: [], problems: [], savedAt: null });
}

const drop = (id: string) => ({ waiting: state.waiting.filter((e) => e.id !== id) });

let flushing: Promise<void> | null = null;
/** Upload what is waiting, oldest first. Safe to call at any time. */
export function flush(): Promise<void> {
  flushing ??= upload().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function upload() {
  const uid = owner;
  if (!uid || !uploader) return;
  await opening;
  const skipped = new Set<string>();
  const heldGroups = new Set<string>();
  while (owner === uid) {
    const entry = state.waiting.find((e) => !skipped.has(e.id) && !(e.group && heldGroups.has(e.group)));
    if (!entry) return;
    const again = entry.tries > 0 || Date.now() - entry.at > FRESH_MS;
    // Counted before sending: if the app dies now, the next try is a repeat.
    set({ waiting: state.waiting.map((e) => (e.id === entry.id ? { ...e, tries: e.tries + 1 } : e)) });
    await persist().catch(() => {});
    inFlight = entry.id;
    let result: UploadResult;
    try {
      result = await uploader(entry, again ? Math.max(0, (Date.now() - entry.at) / 1000) : null, uid);
    } catch {
      result = { type: 'later' };
    } finally {
      inFlight = null;
    }
    if (owner !== uid) return;
    const watched = results.has(entry.id);
    if (watched) results.set(entry.id, result);
    if (result.type === 'no_internet') return;
    if (result.type === 'later') {
      const note = result.message;
      set({ waiting: state.waiting.map((e) => (e.id === entry.id ? { ...e, note } : e)) });
      skipped.add(entry.id);
      if (entry.group) heldGroups.add(entry.group);
      continue;
    }
    if (result.type === 'ok') set(drop(entry.id));
    // A form still on screen shows the reason itself.
    else set({ ...drop(entry.id), problems: watched ? state.problems : [...state.problems, { ...entry, problem: result.message }].slice(-MAX_PROBLEMS) });
    await persist().catch(() => {});
  }
}

/** Keep an entry on the phone, then try to upload it. Never lost, never doubled. */
export async function send(uid: string, kind: EntryKind, path: string, body: Record<string, any>, group?: string): Promise<{ status: string; [k: string]: any }> {
  await openOutbox(uid);
  const entry: Entry = { id: newId(), kind, path, body, at: Date.now(), tries: 0, group };
  // Not the one being sent right now: the server may already have it.
  const older = group ? state.waiting.filter((e) => e.group === group && e.id !== inFlight) : [];
  set({ waiting: [...state.waiting.filter((e) => !older.includes(e)), entry] });
  try {
    await persist();
  } catch (e) {
    console.log('[offline] could not save', e);
    set({ waiting: [...drop(entry.id).waiting, ...older] });
    throw new Error('Your phone could not save this. Free some space and try again.');
  }
  results.set(entry.id, null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([flush().catch(() => {}), new Promise((r) => (timer = setTimeout(r, state.offline ? WAIT_OFFLINE_MS : WAIT_MS)))]);
  clearTimeout(timer);
  const result = results.get(entry.id);
  results.delete(entry.id);
  if (result?.type === 'ok') return result.data;
  if (result?.type === 'refused') throw new Error(result.message);
  return { status: 'queued' };
}

/** Before anything that works out a dose: every entry must be on the server. */
export async function requireSynced() {
  if (!state.waiting.length) return;
  await flush();
  if (state.waiting.some((e) => MATTERS.includes(e.kind))) {
    throw new OfflineError('Some entries are not uploaded yet, so a dose or forecast would be wrong. Try again when you have internet.');
  }
}

/** An entry still on the phone, deleted before it was uploaded. */
export async function removeWaiting(id: string): Promise<boolean> {
  if (id === inFlight) return false;
  set(drop(id));
  await persist().catch(() => {});
  return true;
}

export async function removeProblem(id: string) {
  set({ problems: state.problems.filter((e) => e.id !== id) });
  await persist().catch(() => {});
}

// ------------------------------------------------------------- saved copies

const PREFIX = 'gv.cache.';
const MAX_CHARS = 400_000;
export interface Copy<T> {
  at: number;
  data: T;
}

export async function keepCopy(uid: string, path: string, data: unknown) {
  try {
    const text = JSON.stringify({ at: Date.now(), data });
    if (text.length <= MAX_CHARS) await AsyncStorage.setItem(`${PREFIX}${uid}.${path}`, text);
  } catch (e) {
    console.log('[offline] copy not kept', e);
  }
}

export async function copyOf<T>(uid: string, path: string): Promise<Copy<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${uid}.${path}`);
    return raw ? (JSON.parse(raw) as Copy<T>) : null;
  } catch {
    return null;
  }
}

export function showingCopy(at: number) {
  set({ savedAt: Math.min(at, state.savedAt ?? at) });
}

/** On sign-out. Entries not uploaded yet stay for this account's next sign-in. */
export async function forgetCopies(uid: string) {
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith(`${PREFIX}${uid}.`));
  await AsyncStorage.multiRemove([...keys]).catch(() => {});
}
