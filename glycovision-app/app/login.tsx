// app/login.tsx
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Text, TextInput } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';
import { colors, radius, shadow } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

function Field({
  icon,
  right,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={20} color={colors.textFaint} />
      <TextInput style={styles.input} placeholderTextColor={colors.textFaint} {...props} />
      {right}
    </View>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        Alert.alert('Check your email', 'Confirm your account, then log in.');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // No manual navigation needed — the session change automatically
        // swaps _layout.tsx over to the tab stack.
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#D7E7FF', '#EEF5FF', colors.bg]}
        locations={[0, 0.45, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <LogoMark size={76} />
          <Text style={styles.appName}>GlycoVision</Text>
          <Text style={styles.tagline}>Your diabetes companion: meals, sugar and insulin in one place.</Text>
          <View style={styles.features}>
            {[
              { icon: 'scan' as const, t: 'Scan meals' },
              { icon: 'water' as const, t: 'Track sugar' },
              { icon: 'calculator' as const, t: 'Dose estimate' },
            ].map((f) => (
              <View key={f.t} style={styles.feature}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={18} color={colors.primary} />
                </View>
                <Text style={styles.featureText}>{f.t}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </Text>

          <Text style={styles.label}>Email</Text>
          <Field
            icon="mail-outline"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setError(null);
            }}
            accessibilityLabel="Email"
          />

          <Text style={styles.label}>Password</Text>
          <Field
            icon="lock-closed-outline"
            placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
            secureTextEntry={!showPassword}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            onSubmitEditing={handleAuth}
            accessibilityLabel="Password"
            right={
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textMuted} />
              </Pressable>
            }
          />

          {error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={colors.dangerText} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            label={isSignUp ? 'Create account' : 'Log in'}
            onPress={handleAuth}
            loading={loading}
            style={{ marginTop: 18 }}
          />

          <Pressable
            onPress={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            style={styles.switch}
            accessibilityRole="button"
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? ' : 'New to GlycoVision? '}
              <Text style={styles.switchLink}>{isSignUp ? 'Log in' : 'Create an account'}</Text>
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Research prototype. GlycoVision supports, but does not replace, your care team.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  brand: { alignItems: 'center', marginBottom: 26 },
  appName: { marginTop: 14, fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 15.5, color: colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 22, maxWidth: 300 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  features: { flexDirection: 'row', gap: 10, marginTop: 18 },
  feature: { alignItems: 'center', gap: 6, width: 96 },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureText: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 14 },
  label: { fontSize: 14.5, fontWeight: '700', color: colors.textMuted, marginBottom: 8, marginTop: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  input: { flex: 1, minWidth: 0, fontSize: 17, color: colors.text, paddingVertical: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  errorText: { flex: 1, fontSize: 14.5, color: colors.dangerText, fontWeight: '600' },
  switch: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  switchText: { fontSize: 15, color: colors.textMuted },
  switchLink: { fontWeight: '800', color: colors.primary },
  footer: { fontSize: 13, color: colors.textFaint, textAlign: 'center', marginTop: 20, lineHeight: 19 },
});
