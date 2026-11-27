// lib/googleSignIn.ts
//
// "Continue with Google" through Supabase. The button appears only when the
// Google provider is switched on in the Supabase dashboard, so it can never
// lead to an error page.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

export async function googleEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    return res.ok && (await res.json())?.external?.google === true;
  } catch {
    return false;
  }
}

/** The one-time code from the redirect link, or an error message. */
export function readRedirect(url: string): { code?: string; error?: string } {
  const params = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '');
  const error = params.get('error_description') ?? params.get('error');
  return error ? { error } : { code: params.get('code') ?? undefined };
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = Linking.createURL('auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // closed by the user

  const { code, error: problem } = readRedirect(result.url);
  if (problem) throw new Error(problem);
  if (!code) throw new Error('Google sign-in did not finish. Please try again.');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}
