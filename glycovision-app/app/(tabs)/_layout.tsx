// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';

import { TabBar } from '@/components/TabBar';

// Five tabs with Scan in the centre. The food library is a page that
// opens over the tabs (app/library.tsx), from Scanner or Profile: fewer
// tabs are easier to learn, especially for older patients.
export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="bolus" options={{ title: 'Bolus' }} />
      <Tabs.Screen name="scanner" options={{ title: 'Scan' }} />
      <Tabs.Screen name="voice" options={{ title: 'Voice' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
