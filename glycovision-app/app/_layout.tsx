// app/_layout.tsx
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack, router } from 'expo-router';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import LoginScreen from './login';
import { AppErrorScreen } from '@/components/AppErrorScreen';
import { OfflineBanner } from '@/components/OfflineBanner';
import { configureNotifications, listenForTaps } from '@/lib/notifications';

// A crashed screen shows a calm "Try again" page instead of a red error.
export function ErrorBoundary(props: { error: Error; retry: () => Promise<void> }) {
  return <AppErrorScreen {...props} />;
}

// Notification behaviour and Android channels, once at startup.
configureNotifications();

// SDK 58: `initialRouteName` was removed; `anchor` keeps (tabs) beneath
// any other root screens.
export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function useAuthSession() {
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      // If the stored session can't be read, show login rather than
      // leaving the splash screen up forever.
      .catch(() => setSession(null))
      .finally(() => setReady(true));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return { session, ready };
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

// GlycoVision uses one light design, whatever the phone's dark-mode setting.
const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.card,
    primary: colors.primary,
    text: colors.text,
  },
};

function RootLayoutNav() {
  const { session, ready } = useAuthSession();

  // Tapping a notification opens its screen (only once signed in).
  useEffect(() => {
    if (!session) return;
    return listenForTaps((url) => {
      try {
        router.push(url as any);
      } catch (e) {
        console.log('Could not open notification link', url, e);
      }
    });
  }, [session]);

  if (!ready) {
    return null; // splash stays up until we know session state
  }

  // No session: render the login screen directly instead of routing to it.
  // This guarantees the tab stack (and its data-fetching screens) never
  // mounts before a session exists — no race, no flash of error alerts.
  if (!session) {
    return (
      <ThemeProvider value={appTheme}>
        <LoginScreen />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={appTheme}>
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="library" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="reminders" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="low-help" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="notifications" options={{ headerShown: false, presentation: 'card' }} />
        </Stack>
        <OfflineBanner />
      </View>
    </ThemeProvider>
  );
}