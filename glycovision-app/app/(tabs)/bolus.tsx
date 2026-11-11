// app/(tabs)/bolus.tsx
import React, { useState, useEffect, useCallback } from "react";
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
import {
  calculateIntervention,
  getProfile,
  updateProfile,
  logBolus,
  getDashboardSummary,
  getCurrentIob,
} from "@/services/api";
import { Card } from "@/components/ui/Card";
import { validateClinicalSettings } from "@/constants/clinicalLimits";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

export default function BolusScreen() {
  const [currentBg, setCurrentBg] = useState("");
  const [targetBg, setTargetBg] = useState("110");
  const [isf, setIsf] = useState("50");
  const [iob, setIob] = useState("0");
  const [totalCarbs, setTotalCarbs] = useState("");
  const [icr, setIcr] = useState("10");
  const [diaHours, setDiaHours] = useState("4");

  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loggingDose, setLoggingDose] = useState(false);
  const [doseLogged, setDoseLogged] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { prefillCarbs } = useLocalSearchParams<{ prefillCarbs?: string }>();

  // Reload every time the tab is opened. Tabs stay mounted, so loading
  // only on mount showed stale BG, IOB and profile values after the user
  // logged a reading or changed settings elsewhere.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        try {
          const [profile, summary, iobData] = await Promise.all([
            getProfile(),
            getDashboardSummary(),
            getCurrentIob(),
          ]);
          if (!active) return;

          setTargetBg(String(profile.target_bg ?? 110));
          setIsf(String(profile.isf ?? 50));
          setIcr(String(profile.icr ?? 10));
          setDiaHours(String(iobData.dia_hours ?? profile.dia_hours ?? 4));
          if (summary.latest_bg != null) {
            setCurrentBg(String(summary.latest_bg));
          }
          setIob(String(iobData.iob));

          // Inputs may have changed, so an earlier result no longer applies.
          setResult(null);
          setDoseLogged(false);
        } catch (e) {
          console.error("Failed to load profile", e);
          if (active) {
            Alert.alert(
              "Error",
              "Could not load your clinical profile. Using defaults.",
            );
          }
        } finally {
          if (active) setProfileLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
    if (prefillCarbs) {
      setTotalCarbs(prefillCarbs);
      setResult(null);
      setDoseLogged(false);
    }
  }, [prefillCarbs]);

  // Editing any input invalidates the shown result, so a dose can never
  // be logged together with inputs it was not calculated from.
  const editInput =
    (setter: (value: string) => void) => (value: string) => {
      setter(value);
      setResult(null);
      setDoseLogged(false);
    };

  const handleCalculate = async () => {
    const parsedCurrentBg = Number(currentBg);
    const parsedTargetBg = Number(targetBg);
    const parsedIsf = Number(isf);
    const parsedIob = Number(iob);
    const parsedTotalCarbs = Number(totalCarbs);
    const parsedIcr = Number(icr);

    if (
      !currentBg.trim() ||
      !targetBg.trim() ||
      !isf.trim() ||
      !iob.trim() ||
      !totalCarbs.trim() ||
      !icr.trim()
    ) {
      Alert.alert(
        "Missing inputs",
        "Please enter all required values before calculating a research estimate.",
      );
      return;
    }

    if (
      !Number.isFinite(parsedCurrentBg) ||
      !Number.isFinite(parsedTargetBg) ||
      !Number.isFinite(parsedIsf) ||
      !Number.isFinite(parsedIob) ||
      !Number.isFinite(parsedTotalCarbs) ||
      !Number.isFinite(parsedIcr)
    ) {
      Alert.alert(
        "Invalid inputs",
        "All bolus inputs must be valid numbers.",
      );
      return;
    }

    // Mirror the backend PatientState constraints so invalid values are
    // rejected before an insulin-related research request is submitted.
    if (parsedCurrentBg <= 20 || parsedCurrentBg >= 600) {
      Alert.alert(
        "Invalid current BG",
        "Current BG must be greater than 20 and less than 600 mg/dL.",
      );
      return;
    }

    if (parsedTargetBg <= 70 || parsedTargetBg >= 180) {
      Alert.alert(
        "Invalid target BG",
        "Target BG must be greater than 70 and less than 180 mg/dL.",
      );
      return;
    }

    if (parsedIsf <= 5 || parsedIsf >= 150) {
      Alert.alert(
        "Invalid ISF",
        "ISF must be greater than 5 and less than 150 mg/dL per unit.",
      );
      return;
    }

    if (parsedIob < 0) {
      Alert.alert(
        "Invalid IOB",
        "Estimated active IOB cannot be negative.",
      );
      return;
    }

    if (parsedTotalCarbs < 0) {
      Alert.alert(
        "Invalid carbs",
        "Total carbs cannot be negative.",
      );
      return;
    }

    if (parsedIcr <= 1 || parsedIcr >= 50) {
      Alert.alert(
        "Invalid ICR",
        "ICR must be greater than 1 and less than 50.",
      );
      return;
    }

    setLoading(true);
    setDoseLogged(false);
    setResult(null);

    try {
      const data = await calculateIntervention({
        current_bg: parsedCurrentBg,
        target_bg: parsedTargetBg,
        isf: parsedIsf,
        iob: parsedIob,
        total_carbs: parsedTotalCarbs,
        icr: parsedIcr,
      });

      setResult(data);
    } catch (e: any) {
      console.error("Research bolus calculation failed:", e?.message || e);
      Alert.alert(
        "Calculation unavailable",
        e?.message ||
          "The research estimate could not be calculated. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogDose = async () => {
    if (!result || loggingDose || doseLogged) return;

    setLoggingDose(true);

    try {
      await logBolus({
        dose_units: result.recommended_total_dose_units,
        carbs: parseFloat(totalCarbs),
        current_bg: parseFloat(currentBg),
      });

      setDoseLogged(true);

      // Refresh backend-derived IOB immediately after logging.
      const iobData = await getCurrentIob();
      setIob(String(iobData.iob));

      Alert.alert(
        "Logged",
        "Research bolus estimate saved to your history.",
      );
    } catch (e) {
      Alert.alert("Error", "Could not log this dose.");
    } finally {
      setLoggingDose(false);
    }
  };

  const handleSaveProfile = async () => {
    const problem = validateClinicalSettings({
      icr: parseFloat(icr),
      isf: parseFloat(isf),
      targetBg: parseFloat(targetBg),
      diaHours: parseFloat(diaHours),
    });
    if (problem) {
      Alert.alert("Invalid settings", problem);
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        icr: parseFloat(icr),
        isf: parseFloat(isf),
        target_bg: parseFloat(targetBg),
        dia_hours: parseFloat(diaHours),
      });
      Alert.alert("Saved", "Your clinical profile has been updated.");
    } catch (e) {
      Alert.alert("Error", "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (profileLoading) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
    >
      <Text style={styles.screenTitle}>Research Bolus Estimate</Text>

      {result && (
        <Card style={{ backgroundColor: "#F5F3FF" }}>
          <Text style={styles.recLabel}>RESEARCH BOLUS ESTIMATE</Text>
          <Text style={styles.recValue}>
            {result.recommended_total_dose_units}{" "}
            <Text style={styles.units}>units</Text>
          </Text>
          <Text style={styles.formula}>{result.strategy}</Text>

          <View style={styles.breakdown}>
            <View style={styles.breakRow}>
              <Text>Meal coverage</Text>
              <Text style={styles.breakVal}>
                +{result.breakdown.carb_dose_units} u
              </Text>
            </View>
            <View style={styles.breakRow}>
              <Text>BG correction</Text>
              <Text style={styles.breakVal}>
                +{result.breakdown.correction_dose_units} u
              </Text>
            </View>
            <View style={styles.breakRow}>
              <Text>IOB subtracted</Text>
              <Text style={styles.breakVal}>
                -{Number(result.breakdown.iob_subtracted ?? 0).toFixed(1)} u
              </Text>
            </View>
          </View>

          {result.safety_flags?.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {result.safety_flags.map((flag: string, i: number) => (
                <Text key={i} style={styles.flagText}>
                  ⚠ {flag}
                </Text>
              ))}
            </View>
          )}
          <Text style={styles.disclaimer}>{result.disclaimer}</Text>

          <TouchableOpacity
            style={[
              styles.logBtn,
              doseLogged && styles.loggedBtn,
            ]}
            onPress={handleLogDose}
            disabled={loggingDose || doseLogged}
          >
            {loggingDose ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.logBtnText}>
                {doseLogged ? "✓ Logged" : "Log Research Estimate"}
              </Text>
            )}
          </TouchableOpacity>
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Clinical Inputs</Text>

        <View style={styles.iobBox}>
          <View>
            <Text style={styles.iobLabel}>Estimated Active IOB</Text>
            <Text style={styles.iobNote}>
              Loaded from your logged bolus history
            </Text>
          </View>
          <Text style={styles.iobValue}>
            {Number.isFinite(parseFloat(iob))
              ? `${parseFloat(iob).toFixed(1)} U`
              : "—"}
          </Text>
        </View>

        {[
          { label: "Current BG (mg/dL)", value: currentBg, set: editInput(setCurrentBg) },
          { label: "Target BG (mg/dL)", value: targetBg, set: editInput(setTargetBg) },
          { label: "Total Carbs (g)", value: totalCarbs, set: editInput(setTotalCarbs) },
          { label: "ICR (1:x)", value: icr, set: editInput(setIcr) },
          { label: "ISF (mg/dL per unit)", value: isf, set: editInput(setIsf) },
        ].map((f, i) => (
          <View key={i} style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{f.label}</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={f.value}
              onChangeText={f.set}
            />
          </View>
        ))}

        <TouchableOpacity
          style={styles.calcBtn}
          onPress={handleCalculate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.calcBtnText}>Calculate Dose</Text>
          )}
        </TouchableOpacity>
      </Card>

      <Card>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <Text style={styles.sectionTitle}>Clinical Profile</Text>
          <TouchableOpacity onPress={handleSaveProfile} disabled={saving}>
            <Text style={styles.saveLink}>
              {saving ? "Saving..." : "Save as my profile"}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.profileGrid}>
          <View style={styles.profileItem}>
            <Text style={styles.profileLabel}>ICR</Text>
            <Text style={styles.profileVal}>1 : {icr}</Text>
          </View>
          <View style={styles.profileItem}>
            <Text style={styles.profileLabel}>ISF</Text>
            <Text style={styles.profileVal}>{isf} mg/dL/u</Text>
          </View>
          <View style={styles.profileItem}>
            <Text style={styles.profileLabel}>TARGET</Text>
            <Text style={styles.profileVal}>{targetBg} mg/dL</Text>
          </View>
          <View style={styles.profileItem}>
            <Text style={styles.profileLabel}>DIA</Text>
            <Text style={styles.profileVal}>{diaHours} h</Text>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F7FF" },
  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginTop: 40,
    marginBottom: 16,
    color: "#111827",
  },

  recLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
  recValue: { fontSize: 42, fontWeight: "800", color: "#111827", marginTop: 4 },
  units: { fontSize: 18, fontWeight: "500", color: "#6B7280" },
  formula: { fontSize: 13, color: "#6B7280", marginBottom: 16 },
  breakdown: { borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 12 },
  breakRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  breakVal: { fontWeight: "600" },
  flagText: {
    color: "#D97706",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  disclaimer: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 14,
    fontStyle: "italic",
  },
  logBtn: {
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 14,
  },
  logBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  loggedBtn: {
    backgroundColor: "#059669",
  },

  iobBox: {
    backgroundColor: "#F5F3FF",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  iobLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  iobNote: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 3,
  },
  iobValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#7C3AED",
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 14,
    color: "#111827",
  },
  saveLink: { fontSize: 13, fontWeight: "600", color: "#7C3AED" },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 13, color: "#6B7280", marginBottom: 6 },
  input: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
  },
  calcBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  calcBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  profileItem: {
    width: "47%",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    padding: 14,
  },
  profileLabel: { fontSize: 11, color: "#6B7280", fontWeight: "600" },
  profileVal: { fontSize: 18, fontWeight: "700", marginTop: 4 },
});
