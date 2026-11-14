// app/(tabs)/profile.tsx
//
// Profile: identity card, personal info, insulin settings as large
// number fields, and links. Load/save/logout logic unchanged.

import React, { useState, useEffect } from "react";

import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Text, TextInput } from "@/components/ui/Typography";

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { Card } from "@/components/ui/Card";
import { NotificationBell } from "@/components/NotificationBell";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { ListRow, SectionHeader } from "@/components/ui/Bits";
import { colors, radius, tabular } from "@/constants/theme";

import {
  getProfile,
  updateProfile,
} from "@/services/api";

import { supabase } from "@/lib/supabase";
import { validateClinicalSettings } from "@/constants/clinicalLimits";


const DIABETES_TYPES = [
  "Type 1",
  "Type 2",
  "Gestational",
  "Other",
];


export default function ProfileScreen() {

  const [fullName, setFullName] =
    useState("");

  const [diabetesType, setDiabetesType] =
    useState("Type 1");

  const [icr, setIcr] =
    useState("10");

  const [isf, setIsf] =
    useState("50");

  const [targetBg, setTargetBg] =
    useState("110");

  const [diaHours, setDiaHours] =
    useState("4");

  const [email, setEmail] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);


  // -----------------------------------------------------
  // LOAD PROFILE
  // -----------------------------------------------------

  useEffect(() => {

    (async () => {

      try {

        const profile =
          await getProfile();

        setFullName(
          profile.full_name ?? ""
        );

        setDiabetesType(
          profile.diabetes_type ?? "Type 1"
        );

        setIcr(
          String(
            profile.icr ?? 10
          )
        );

        setIsf(
          String(
            profile.isf ?? 50
          )
        );

        setTargetBg(
          String(
            profile.target_bg ?? 110
          )
        );

        setDiaHours(
          String(
            profile.dia_hours ?? 4
          )
        );


        const { data } =
          await supabase.auth.getUser();

        setEmail(
          data.user?.email ?? ""
        );

      } catch (error) {

        console.error(
          "Failed to load profile",
          error
        );

        Alert.alert(
          "Error",
          "Could not load your profile."
        );

      } finally {

        setLoading(false);

      }

    })();

  }, []);


  // -----------------------------------------------------
  // SAVE PROFILE
  // -----------------------------------------------------

  const handleSave = async () => {

    const parsedIcr =
      parseFloat(icr);

    const parsedIsf =
      parseFloat(isf);

    const parsedTargetBg =
      parseFloat(targetBg);

    const parsedDiaHours =
      parseFloat(diaHours);


    // Same limits the backend enforces.
    const problem = validateClinicalSettings({
      icr: parsedIcr,
      isf: parsedIsf,
      targetBg: parsedTargetBg,
      diaHours: parsedDiaHours,
    });

    if (problem) {
      Alert.alert("Invalid values", problem);
      return;
    }


    setSaving(true);


    try {

      await updateProfile({
        full_name: fullName,
        diabetes_type: diabetesType,
        icr: parsedIcr,
        isf: parsedIsf,
        target_bg: parsedTargetBg,
        dia_hours: parsedDiaHours,
      });


      Alert.alert(
        "Saved",
        "Your profile has been updated."
      );

    } catch (error) {

      console.error(
        "Profile save failed",
        error
      );

      Alert.alert(
        "Error",
        "Could not save your profile."
      );

    } finally {

      setSaving(false);

    }

  };


  // -----------------------------------------------------
  // LOGOUT
  // -----------------------------------------------------

  const handleLogout = async () => {

    try {

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

    } catch (error) {

      console.error(
        "Logout failed",
        error
      );

      Alert.alert(
        "Error",
        "Could not log out."
      );

    }

  };


  // -----------------------------------------------------
  // LOADING
  // -----------------------------------------------------

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </Screen>
    );
  }

  const initials =
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "G";

  const settingFields = [
    { label: "Carb ratio", unit: "g/u", hint: "1 unit covers … g carbs", value: icr, set: setIcr },
    { label: "Sensitivity", unit: "mg/dL/u", hint: "Drop per 1 unit", value: isf, set: setIsf },
    { label: "Target sugar", unit: "mg/dL", hint: "Your goal reading", value: targetBg, set: setTargetBg },
    { label: "Insulin action", unit: "h", hint: "Usually 3–5 hours", value: diaHours, set: setDiaHours },
  ];

  // -----------------------------------------------------
  // UI
  // -----------------------------------------------------

  return (
    <Screen title="Profile" right={<NotificationBell />}>
      <Card variant="hero" style={styles.idCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.idName} numberOfLines={1}>
            {fullName || "Your name"}
          </Text>
          <Text style={styles.idEmail} numberOfLines={1}>
            {email}
          </Text>
          <View style={styles.idPill}>
            <Ionicons name="water" size={13} color={colors.heroText} />
            <Text style={styles.idPillText}>{diabetesType}</Text>
          </View>
        </View>
      </Card>

      <SectionHeader title="About you" />
      <Card>
        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Full name"
        />

        <Text style={[styles.label, { marginTop: 16 }]}>Diabetes type</Text>
        <View style={styles.typeRow}>
          {DIABETES_TYPES.map((t) => {
            const active = diabetesType === t;
            return (
              <Pressable
                key={t}
                onPress={() => setDiabetesType(t)}
                style={[styles.typeChip, active && styles.typeChipActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t}
              >
                {active ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionHeader title="Insulin settings" />
      <Card>
        <Text style={styles.sectionSub}>
          Used by the bolus estimate and active-insulin model. Ask your doctor for these numbers.
        </Text>
        <View style={styles.grid}>
          {settingFields.map((f) => (
            <View key={f.label} style={styles.gridItem}>
              <Text style={styles.label}>{f.label}</Text>
              <View style={styles.numBox}>
                <TextInput
                  style={styles.numInput}
                  keyboardType="decimal-pad"
                  value={f.value}
                  onChangeText={f.set}
                  accessibilityLabel={`${f.label} in ${f.unit}`}
                />
                <Text style={styles.numUnit}>{f.unit}</Text>
              </View>
              <Text style={styles.hint}>{f.hint}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Button label="Save changes" icon="checkmark" onPress={handleSave} loading={saving} />

      <SectionHeader title="Safety & reminders" style={{ marginTop: 22 }} />
      <Card>
        <ListRow
          icon="notifications"
          title="Reminders & alerts"
          detail="Sugar checks, medicine times and smart alerts"
          onPress={() => router.push("/reminders")}
        />
        <View style={styles.divider} />
        <ListRow
          icon="medkit"
          tone="danger"
          title="Low sugar help"
          detail="Rule of 15, timer and emergency contact"
          onPress={() => router.push("/low-help")}
        />
      </Card>

      <SectionHeader title="Good to know" />
      <Card>
        <ListRow
          icon="mic"
          tone="warning"
          title="Voice checks"
          detail="Add stress context to your advice. They never change an insulin dose."
          onPress={() => router.push("/(tabs)/voice")}
        />
        <View style={styles.divider} />
        <ListRow
          icon="book"
          title="Food library"
          detail="Carbs for 88 dishes, with sources"
          onPress={() => router.push("/library")}
        />
      </Card>

      <Button label="Log out" icon="log-out-outline" variant="secondary" onPress={handleLogout} style={styles.logout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  idCard: { flexDirection: "row", alignItems: "center", gap: 16, padding: 20, borderRadius: radius.xl },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.heroRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 24, fontWeight: "800", color: colors.heroText },
  idName: { fontSize: 21, fontWeight: "800", color: colors.heroText },
  idEmail: { fontSize: 14.5, color: colors.heroMuted, marginTop: 2 },
  idPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: colors.heroRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  idPillText: { fontSize: 13, fontWeight: "700", color: colors.heroText },

  label: { fontSize: 14.5, fontWeight: "700", color: colors.textMuted, marginBottom: 8 },
  input: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 17,
    color: colors.text,
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 15, fontWeight: "700", color: colors.text },
  typeChipTextActive: { color: "#FFFFFF" },

  sectionSub: { fontSize: 14.5, lineHeight: 21, color: colors.textMuted, marginBottom: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridItem: { width: "47%", flexGrow: 1 },
  numBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  numInput: { flex: 1, minWidth: 0, fontSize: 21, fontWeight: "800", color: colors.text, paddingVertical: 10, ...tabular },
  numUnit: { fontSize: 13.5, fontWeight: "700", color: colors.textFaint },
  hint: { fontSize: 13, color: colors.textFaint, marginTop: 6 },

  divider: { height: 1, backgroundColor: colors.divider },
  logout: { marginTop: 8 },
});
