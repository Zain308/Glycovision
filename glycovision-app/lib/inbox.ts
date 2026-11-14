// lib/inbox.ts
//
// The in-app notification inbox behind the bell icon. Every alert and
// reminder GlycoVision raises is kept here (on the phone, newest first,
// max 60), even when phone notifications are blocked or on web, so the
// user can always see what happened. Screens subscribe for live updates
// of the list and the unread count.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type InboxKind = 'low' | 'high' | 'meal' | 'risk' | 'reminder' | 'timer' | 'info';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  url: string;
  createdAt: string; // ISO
  read: boolean;
}

const KEY = 'gv.inbox.v1';
const MAX = 60;

let items: InboxItem[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<(items: InboxItem[]) => void>();

function emit() {
  const snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}

export function loadInbox(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => {
        items = raw ? (JSON.parse(raw) as InboxItem[]) : [];
      })
      .catch(() => {
        items = [];
      })
      .then(async () => {
        loaded = true;
        if (items.length === 0) {
          // First run: a friendly welcome that points to reminders.
          items = [
            {
              id: 'welcome',
              kind: 'info',
              title: 'Welcome to GlycoVision',
              body: 'Turn on daily reminders so you never miss a sugar check or a dose.',
              url: '/reminders',
              createdAt: new Date().toISOString(),
              read: false,
            },
          ];
          await persist();
        }
        emit();
      });
  }
  return loading;
}

export function subscribeInbox(listener: (items: InboxItem[]) => void): () => void {
  listeners.add(listener);
  loadInbox().then(() => listener([...items]));
  return () => {
    listeners.delete(listener);
  };
}

export async function addInboxItem(item: Omit<InboxItem, 'id' | 'createdAt' | 'read'> & { id?: string; createdAt?: string }) {
  await loadInbox();
  const id = item.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (items.some((x) => x.id === id)) return; // already recorded
  items = [
    { ...item, id, createdAt: item.createdAt ?? new Date().toISOString(), read: false },
    ...items,
  ].slice(0, MAX);
  emit();
  await persist();
}

export async function markRead(id: string) {
  await loadInbox();
  items = items.map((x) => (x.id === id ? { ...x, read: true } : x));
  emit();
  await persist();
}

export async function markAllRead() {
  await loadInbox();
  items = items.map((x) => ({ ...x, read: true }));
  emit();
  await persist();
}

export async function clearInbox() {
  await loadInbox();
  items = [];
  emit();
  await persist();
}

export const unreadCount = (list: InboxItem[]) => list.filter((x) => !x.read).length;
