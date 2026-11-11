// app/(tabs)/profile.tsx

import React, { useState, useEffect } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { Card } from "@/components/ui/Card";

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

      <View
        style={[
          styles.container,
          styles.loadingContainer,
        ]}
      >

        <ActivityIndicator
          size="large"
          color="#7C3AED"
        />

      </View>

    );

  }


  // -----------------------------------------------------
  // UI
  // -----------------------------------------------------

  return (

    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: 20,
        paddingBottom: 50,
      }}
    >

      <Text style={styles.screenTitle}>
        Profile
      </Text>


      {/* ACCOUNT CARD */}

      <Card style={styles.avatarCard}>

        <View style={styles.avatarCircle}>

          <Ionicons
            name="person"
            size={32}
            color="#7C3AED"
          />

        </View>


        <Text style={styles.emailText}>
          {email}
        </Text>

      </Card>


      {/* PERSONAL INFORMATION */}

      <Card>

        <Text style={styles.sectionTitle}>
          Personal Info
        </Text>


        <View style={styles.inputGroup}>

          <Text style={styles.inputLabel}>
            Full Name
          </Text>

          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            placeholderTextColor="#9CA3AF"
          />

        </View>


        <View style={styles.inputGroup}>

          <Text style={styles.inputLabel}>
            Diabetes Type
          </Text>


          <View style={styles.typeRow}>

            {DIABETES_TYPES.map(
              (type) => (

                <TouchableOpacity

                  key={type}

                  style={[
                    styles.typeChip,

                    diabetesType === type &&
                      styles.typeChipActive,
                  ]}

                  onPress={() =>
                    setDiabetesType(type)
                  }
                >

                  <Text
                    style={[
                      styles.typeChipText,

                      diabetesType === type &&
                        styles.typeChipTextActive,
                    ]}
                  >

                    {type}

                  </Text>

                </TouchableOpacity>

              )
            )}

          </View>

        </View>

      </Card>


      {/* CLINICAL SETTINGS */}

      <Card>

        <Text style={styles.sectionTitle}>
          Clinical Settings
        </Text>

        <Text style={styles.sectionSub}>
          These settings are used by the prototype
          bolus calculation and insulin-on-board engine.
        </Text>


        {[
          {
            label: "ICR (1:x)",
            value: icr,
            setValue: setIcr,
          },

          {
            label: "ISF (mg/dL per unit)",
            value: isf,
            setValue: setIsf,
          },

          {
            label: "Target BG (mg/dL)",
            value: targetBg,
            setValue: setTargetBg,
          },

          {
            label: "DIA (hours, 3–8)",
            value: diaHours,
            setValue: setDiaHours,
          },
        ].map(
          (field, index) => (

            <View
              key={index}
              style={styles.inputGroup}
            >

              <Text style={styles.inputLabel}>
                {field.label}
              </Text>


              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={field.value}
                onChangeText={field.setValue}
              />

            </View>

          )
        )}


        <TouchableOpacity
          style={[
            styles.saveBtn,
            saving &&
              styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={saving}
        >

          {saving ? (

            <ActivityIndicator
              color="#fff"
            />

          ) : (

            <Text style={styles.saveBtnText}>
              Save Changes
            </Text>

          )}

        </TouchableOpacity>

      </Card>


      {/* VOICE CONTEXT INFO */}

      <Card>

        <View style={styles.infoHeader}>

          <View style={styles.infoIconCircle}>

            <Ionicons
              name="mic-outline"
              size={20}
              color="#7C3AED"
            />

          </View>


          <View style={{ flex: 1 }}>

            <Text style={styles.sectionTitle}>
              Voice Context
            </Text>

            <Text style={styles.infoText}>
              Voice recordings are analyzed separately
              as experimental acoustic context. They do
              not directly modify insulin calculations.
            </Text>

          </View>

        </View>

      </Card>


      {/* LOGOUT */}

      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
      >

        <Ionicons
          name="log-out-outline"
          size={18}
          color="#EF4444"
        />

        <Text style={styles.logoutText}>
          Log Out
        </Text>

      </TouchableOpacity>

    </ScrollView>

  );

}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F8F7FF",
  },

  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
  },


  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginTop: 40,
    marginBottom: 16,
    color: "#111827",
  },


  avatarCard: {
    alignItems: "center",
    paddingVertical: 24,
  },

  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  emailText: {
    color: "#6B7280",
    fontSize: 14,
  },


  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
    color: "#111827",
  },

  sectionSub: {
    fontSize: 12,
    color: "#9CA3AF",
    marginBottom: 14,
    lineHeight: 18,
  },


  inputGroup: {
    marginBottom: 14,
  },

  inputLabel: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },


  typeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  typeChipActive: {
    backgroundColor: "#EDE9FE",
    borderColor: "#7C3AED",
  },

  typeChipText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "600",
  },

  typeChipTextActive: {
    color: "#7C3AED",
  },


  saveBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },

  saveBtnDisabled: {
    opacity: 0.6,
  },

  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },


  infoHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  infoIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
  },

  infoText: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 18,
  },


  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 10,
  },

  logoutText: {
    color: "#EF4444",
    fontWeight: "600",
    fontSize: 15,
  },

});