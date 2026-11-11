// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

// React Native 0.88 types tab icon colors as ColorValue, which can be null;
// the icon components need a string.
const iconColor = (color: ColorValue) =>
  typeof color === 'string' ? color : '#9CA3AF';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#7C3AED',      // purple from your design
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          elevation: 8,
          height: 60,
          paddingBottom: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="grid" size={22} color={iconColor(color)} />,
        }}
      />
      <Tabs.Screen
        name="scanner"
        options={{
          title: 'Scanner',
          tabBarIcon: ({ color }) => <Ionicons name="camera" size={22} color={iconColor(color)} />,
        }}
      />
      <Tabs.Screen
        name="bolus"
        options={{
          title: 'Bolus',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="needle" size={22} color={iconColor(color)} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ color }) => <Ionicons name="mic" size={22} color={iconColor(color)} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <FontAwesome5 name="utensils" size={20} color={iconColor(color)} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" size={22} color={iconColor(color)} />,
        }}
      />
    </Tabs>
    
  );
}