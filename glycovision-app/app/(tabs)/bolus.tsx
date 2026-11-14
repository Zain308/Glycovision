// app/(tabs)/bolus.tsx
//
// Research bolus estimate. The result is the hero (one big number, then
// how it was built); inputs are large number fields with their units, split
// into "this meal" and "your settings". Validation and safety logic are
// unchanged from the previous design.
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Text, TextInput } from "@/components/ui/Typography";
import {
  calculateIntervention,
  getProfile,
  updateProfile,
  logBolus,
  getDashboardSummary,
  getCurrentIob,
} from "@/services/api";
import { Card } from "@/components/ui/Card";
import { NotificationBell } from "@/components/NotificationBell";
import { AnimatedNumber } from "@/components/ui/Motion";
import { haptic } from "@/lib/haptics";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { IconBadge, SectionHeader, StatusPill } from "@/components/ui/Bits";
import { ResearchNote } from "@/components/ui/ResearchNote";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, radius, tabular } from "@/constants/theme";
import { LIMITS, validateClinicalSettings } from "@/constants/clinicalLimits";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

function NumberField({
  label,
  unit,
  value,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldBox}>
        <TextInput
          style={styles.fieldInput}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChange}
          accessibilityLabel={`${label} in ${unit}`}
          placeholder="—"
          placeholderTextColor={colors.textFaint}
        />
        <Text style={styles.fieldUnit}>{unit}</Text>
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

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

    if (parsedTotalCarbs > LIMITS.mealCarbs.max) {
      Alert.alert(
        "Check the carbs",
        `${parsedTotalCarbs} g is more than one meal can hold (max ${LIMITS.mealCarbs.max} g). Did you mean ${Math.round(parsedTotalCarbs / 10)} g?`,
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
      haptic.success();
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
      haptic.success();

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
      <Screen scroll={false} contentStyle={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </Screen>
    );
  }

  const iobNum = parseFloat(iob);

  return (
    <Screen title="Insulin estimate" subtitle="Research calculator. Always follow your care team's advice." right={<NotificationBell />}>
      {result && (
        <Card variant="hero" style={styles.resultCard}>
          <Text style={styles.resultLabel}>ESTIMATED DOSE</Text>
          <View style={styles.resultRow}>
            <AnimatedNumber value={Number(result.recommended_total_dose_units)} decimals={1} style={styles.resultValue} />
            <Text style={styles.resultUnit}>units</Text>
          </View>
          {result.strategy ? <Text style={styles.resultStrategy}>{result.strategy}</Text> : null}

          {/* How the dose is built: meal + correction, minus insulin still active */}
          <View style={styles.doseBar}>
            {[
              { k: "meal", v: Math.max(0, Number(result.breakdown.carb_dose_units) || 0), c: colors.primary },
              { k: "corr", v: Math.max(0, Number(result.breakdown.correction_dose_units) || 0), c: colors.warning },
              { k: "iob", v: Math.max(0, Number(result.breakdown.iob_subtracted) || 0), c: "#C9D6EA" },
            ]
              .filter((s) => s.v > 0)
              .map((s) => (
                <View key={s.k} style={{ flex: s.v, backgroundColor: s.c }} />
              ))}
          </View>

          <View style={styles.breakdown}>
            {[
              { l: "For the meal", v: `+${result.breakdown.carb_dose_units}`, c: colors.primary },
              { l: "To correct high sugar", v: `+${result.breakdown.correction_dose_units}`, c: colors.warning },
              { l: "Insulin still active", v: `−${Number(result.breakdown.iob_subtracted ?? 0).toFixed(1)}`, c: "#C9D6EA" },
            ].map((r) => (
              <View key={r.l} style={styles.breakRow}>
                <View style={styles.breakLabelRow}>
                  <View style={[styles.breakDot, { backgroundColor: r.c }]} />
                  <Text style={styles.breakLabel}>{r.l}</Text>
                </View>
                <Text style={styles.breakVal}>{r.v} u</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {result && (
        <>
          {result.safety_flags?.length > 0 && (
            <View style={styles.flagBox}>
              {result.safety_flags.map((flag: string, i: number) => (
                <View key={i} style={styles.flagRow}>
                  <Ionicons name="warning" size={18} color={colors.dangerText} />
                  <Text style={styles.flagText}>{flag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Stress from a recent voice check: advice only, dose unchanged. */}
          {result.stress_context?.bolus_note ? (
            <View style={styles.stressBox}>
              <View style={styles.stressHeader}>
                <Ionicons name="pulse" size={18} color={colors.warningText} />
                <Text style={styles.stressTitle}>{result.stress_context.headline}</Text>
              </View>
              <Text style={styles.stressText}>{result.stress_context.bolus_note}</Text>
            </View>
          ) : null}

          <Button
            label={doseLogged ? "Saved to your history" : "Save this estimate"}
            icon={doseLogged ? "checkmark-circle" : "bookmark-outline"}
            variant={doseLogged ? "success" : "dark"}
            onPress={handleLogDose}
            loading={loggingDose}
            disabled={doseLogged}
          />
          <ResearchNote label="Research prototype · not a prescription" details={result.disclaimer} />
          <View style={{ height: 18 }} />
        </>
      )}

      <SectionHeader title="This meal" />
      <Card>
        <View style={styles.fieldRow}>
          <NumberField label="Blood sugar now" unit="mg/dL" value={currentBg} onChange={editInput(setCurrentBg)} />
          <NumberField label="Carbs" unit="g" value={totalCarbs} onChange={editInput(setTotalCarbs)} />
        </View>

        <View style={styles.iobBox}>
          <IconBadge tone="brand" size={40} renderIcon={(c, s) => <MaterialCommunityIcons name="needle" size={s} color={c} />} />
          <View style={{ flex: 1 }}>
            <Text style={styles.iobLabel}>Insulin still active</Text>
            <Text style={styles.iobNote}>From your logged doses</Text>
          </View>
          <Text style={styles.iobValue}>{Number.isFinite(iobNum) ? `${iobNum.toFixed(1)} u` : "—"}</Text>
        </View>

        <Button label="Calculate dose" icon="calculator" onPress={handleCalculate} loading={loading} style={{ marginTop: 16 }} />
      </Card>

      <SectionHeader title="Your settings" action={saving ? "Saving…" : "Save"} onAction={handleSaveProfile} />
      <Card>
        <View style={styles.fieldRow}>
          <NumberField label="Target sugar" unit="mg/dL" value={targetBg} onChange={editInput(setTargetBg)} />
          <NumberField label="Carb ratio" unit="g/u" value={icr} onChange={editInput(setIcr)} hint="1 unit per … g carbs" />
        </View>
        <View style={styles.fieldRow}>
          <NumberField label="Sensitivity" unit="mg/dL/u" value={isf} onChange={editInput(setIsf)} hint="Drop per 1 unit" />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Insulin action</Text>
            <View style={[styles.fieldBox, styles.fieldReadOnly]}>
              <Text style={styles.fieldInput}>{diaHours}</Text>
              <Text style={styles.fieldUnit}>h</Text>
            </View>
            <Text style={styles.fieldHint}>Set in Profile</Text>
          </View>
        </View>
        <StatusPill tone="neutral" icon="information-circle" label="Ask your doctor for these numbers" style={{ marginTop: 4 }} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Result
  resultCard: { padding: 22, borderRadius: radius.xl, marginBottom: 12 },
  resultLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 1, color: colors.heroMuted },
  resultRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 },
  resultValue: { fontSize: 64, fontWeight: "800", color: colors.heroText, letterSpacing: -2, ...tabular },
  resultUnit: { fontSize: 20, fontWeight: "700", color: colors.heroMuted },
  resultStrategy: { fontSize: 14.5, color: colors.heroMuted, marginTop: 2 },
  doseBar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2, marginTop: 16 },
  breakLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  breakDot: { width: 10, height: 10, borderRadius: 5 },
  breakdown: {
    marginTop: 16,
    backgroundColor: colors.heroRaised,
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  breakRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  breakLabel: { fontSize: 15.5, color: colors.heroMuted },
  breakVal: { fontSize: 16, fontWeight: "800", color: colors.heroText, ...tabular },

  flagBox: {
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    marginBottom: 12,
  },
  flagRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  flagText: { flex: 1, color: colors.dangerText, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  stressBox: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    gap: 6,
    marginBottom: 12,
  },
  stressHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  stressTitle: { flex: 1, fontSize: 15.5, fontWeight: "800", color: colors.warningText },
  stressText: { fontSize: 14.5, lineHeight: 21, color: colors.warningText },

  // Fields
  fieldRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  field: { flex: 1 },
  fieldLabel: { fontSize: 14.5, fontWeight: "700", color: colors.textMuted, marginBottom: 8 },
  fieldBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.input,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  fieldReadOnly: { backgroundColor: colors.surfaceMuted, opacity: 0.85 },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    paddingVertical: 10,
    ...tabular,
  },
  fieldUnit: { fontSize: 14, fontWeight: "700", color: colors.textFaint },
  fieldHint: { fontSize: 13, color: colors.textFaint, marginTop: 6 },

  iobBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primaryPale,
    borderRadius: radius.md,
    padding: 14,
  },
  iobLabel: { fontSize: 15.5, fontWeight: "800", color: colors.text },
  iobNote: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
  iobValue: { fontSize: 22, fontWeight: "800", color: colors.primary, ...tabular },
});
