// services/api.ts network wrapper: timeouts, retry rules and errors.

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn(() => Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null })) } },
}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('@/lib/config', () => ({ API_URL: 'http://test' }));

import { supabase } from '@/lib/supabase';
import { getFoodLibrary, logMeal } from '@/services/api';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as any).fetch = fetchMock;
  jest.useRealTimers();
});

test('sends the login token', async () => {
  fetchMock.mockReturnValueOnce(ok({ foods: [] }));
  await getFoodLibrary();
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
});

test('GET retries once after a network failure', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed')).mockReturnValueOnce(ok({ foods: [{ food_name: 'chai' }] }));
  const foods = await getFoodLibrary();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(foods[0].food_name).toBe('chai');
});

test('GET gives a plain-language error after two failures', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  await expect(getFoodLibrary()).rejects.toThrow(/Check your internet/);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('POST is never retried (no double logging)', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  await expect(logMeal({ food_name: 'x', carbs: 10, protein: 0, fat: 0, calories: 0 } as any)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a hanging request times out instead of spinning forever', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation((_u: string, init: RequestInit) =>
    new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  );
  const p = logMeal({ food_name: 'x', carbs: 10, protein: 0, fat: 0, calories: 0 } as any);
  const assertion = expect(p).rejects.toThrow(/took too long/);
  await jest.advanceTimersByTimeAsync(20_001);
  await assertion;
});

test('server error is reported, not swallowed', async () => {
  fetchMock.mockReturnValue(Promise.resolve(new Response('boom', { status: 500 })));
  await expect(getFoodLibrary()).rejects.toThrow(/boom/);
});

test('logged-out user gets a clear error and no request is sent', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null }, error: null });
  await expect(getFoodLibrary()).rejects.toThrow(/log in/i);
  expect(fetchMock).not.toHaveBeenCalled();
});
