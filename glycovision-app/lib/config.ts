// lib/config.ts
//
// App configuration from .env (see .env.example). Expo only exposes
// variables prefixed EXPO_PUBLIC_, and only when read as a direct
// `process.env.EXPO_PUBLIC_NAME` expression, so don't destructure them.
//
// These values end up inside the app bundle, so they must never be
// secrets. The Supabase anon key is designed to be public; the
// service-role key belongs on the backend only.

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env in glycovision-app, ` +
        "fill it in, then restart Expo with `npx expo start -c`.",
    );
  }
  return value.trim().replace(/\/+$/, "");
}

// Backend base URL, e.g. http://192.168.1.10:8000 on your Wi-Fi during
// development, or https://api.example.com in production.
export const API_URL = required(
  "EXPO_PUBLIC_API_URL",
  process.env.EXPO_PUBLIC_API_URL,
);

export const SUPABASE_URL = required(
  "EXPO_PUBLIC_SUPABASE_URL",
  process.env.EXPO_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
