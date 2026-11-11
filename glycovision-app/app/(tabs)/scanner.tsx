// app/(tabs)/scanner.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { analyzeMeal, getProfile, logMeal } from "@/services/api";
import { Card } from "@/components/ui/Card";
import { PortionPicker } from "@/components/PortionPicker";
import {
  MealNutrition,
  describePortion,
  isPortionInfo,
  scaleNutrition,
} from "@/lib/portion";

export default function ScannerScreen() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [icrUsed, setIcrUsed] = useState<number | null>(null);
  // How much the user says they ate, in grams. Starts at one unit.
  const [portionGrams, setPortionGrams] = useState<number | null>(null);

  const processImage = async (uri: string, mimeType?: string | null) => {
    setImage(uri);
    setLoading(true);
    setResult(null);
    setLogged(false);
    setIcrUsed(null);
    setPortionGrams(null);
    setStep(0);

    try {
      // Steps reflect real progress: 1 = uploading, 2 = analyzing.
      const data = await analyzeMeal(uri, {
        mimeType,
        onStage: (stage) => setStep(stage === "uploading" ? 1 : 2),
      });
      setStep(3);
      if (!data.ai_found || data.ai_found.length === 0) {
        Alert.alert(
          "No food detected",
          "This photo doesn't look like it contains food. Try again with a clearer meal photo.",
        );
        setImage(null);
        return;
      }
      setResult(data);
      if (isPortionInfo(data.portion)) {
        setPortionGrams(data.portion.unit_grams);
      }

      // The dish was recognised but no nutrition source knows it.
      // Never estimate a dose from missing carbs.
      if (data.nutrition_found === false) {
        return;
      }

      // The ICR is used for the meal-coverage estimate, which is
      // recalculated whenever the portion changes.
      try {
        const profile = await getProfile();
        setIcrUsed(profile.icr ?? 10);
      } catch (e) {
        console.error("Could not load profile for dose estimate", e);
      }
    } catch (e: any) {
      console.error("Scan failed:", e.message || e);
      Alert.alert("Error", e.message || "Could not reach the backend. Check IP & server.");
  
    } finally {
      setLoading(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed");
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: true,
    });
    if (!res.canceled) processImage(res.assets[0].uri, res.assets[0].mimeType);
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: true,
    });
    if (!res.canceled) processImage(res.assets[0].uri, res.assets[0].mimeType);
  };

  // Nutrition for the portion the user chose. When the backend sent no
  // portion info, the values are used as returned.
  const portionedMeal = (): { nutrition: MealNutrition; label: string | null } | null => {
    if (!result || result.nutrition_found === false) return null;
    const s = result.summary;
    const base: MealNutrition = {
      carbs: Number(s.total_estimated_carbs) || 0,
      protein: Number(s.total_protein) || 0,
      fat: Number(s.total_fat) || 0,
      calories: Number(s.total_calories) || 0,
    };
    if (isPortionInfo(result.portion) && portionGrams) {
      return {
        nutrition: scaleNutrition(base, result.portion, portionGrams),
        label: describePortion(result.portion, portionGrams),
      };
    }
    return { nutrition: base, label: null };
  };

  const changePortion = (grams: number) => {
    setPortionGrams(grams);
    // A logged meal used the old quantity; allow logging the new one.
    setLogged(false);
  };

  const handleLogMeal = async () => {
    const meal = portionedMeal();
    if (!meal) return;
    setLogging(true);
    try {
      const names = (result.ai_found || [])
        .map((i: any) => i.food_name)
        .join(" + ");
      const name = names || "Scanned meal";
      await logMeal({
        food_name: meal.label ? `${name} (${meal.label})` : name,
        carbs: meal.nutrition.carbs,
        protein: meal.nutrition.protein,
        fat: meal.nutrition.fat,
        calories: meal.nutrition.calories,
      });
      setLogged(true);
    } catch (e) {
      Alert.alert("Error", "Could not log this meal.");
    } finally {
      setLogging(false);
    }
  };

  const goToBolusWithCarbs = () => {
    if (!result) return;
    // Without known carbs, open Bolus empty so the user enters them.
    if (result.nutrition_found === false) {
      router.push("/(tabs)/bolus");
      return;
    }
    const meal = portionedMeal();
    router.push({
      pathname: "/(tabs)/bolus",
      params: { prefillCarbs: String(meal?.nutrition.carbs ?? "") },
    });
  };

  // ——— RESULT VIEW ———
  if (result && result.summary) {
    const item = result.ai_found?.[0] || {};
    const nutritionFound = result.nutrition_found !== false;
    // Show the real confidence only; never invent one.
    const confidencePct =
      typeof item.confidence === "number"
        ? Math.round(item.confidence * 100)
        : null;

    // Values for the chosen portion; "—" when nutrition is unknown.
    const meal = portionedMeal();
    const calories = meal?.nutrition.calories ?? null;
    const carbs = meal?.nutrition.carbs ?? null;
    const protein = meal?.nutrition.protein ?? null;
    const fat = meal?.nutrition.fat ?? null;
    const show = (value: number | null, unit = "") =>
      value === null ? "—" : `${value}${unit}`;
    const portion = isPortionInfo(result.portion) ? result.portion : null;
    const mealCoverageUnits =
      carbs !== null && icrUsed ? Math.round((carbs / icrUsed) * 10) / 10 : null;

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>AI Food Scanner</Text>
        </View>

        {image && <Image source={{ uri: image }} style={styles.resultImage} />}

        <Card>
          <View style={styles.badgeRow}>
            <View style={styles.dbBadge}>
              <Text style={styles.dbText}>
                GlycoVision Food Analysis
                {confidencePct !== null ? ` · ${confidencePct}%` : ""}
              </Text>
            </View>
          </View>

          <Text style={styles.foodName}>
            {item.food_name || "Detected Meal"}
          </Text>

          {nutritionFound && portion && portionGrams !== null && (
            <PortionPicker
              portion={portion}
              grams={portionGrams}
              onChange={changePortion}
            />
          )}

          {nutritionFound && !portion && item.estimated_volume && (
            <Text style={styles.servingNote}>
              Values for {item.estimated_volume}. Adjust for your actual portion.
            </Text>
          )}

          {!nutritionFound && (
            <View style={styles.unknownBox}>
              <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
              <Text style={styles.unknownText}>
                We recognised this dish but don't have its nutrition data yet.
                Check the label or a food guide, then enter the carbs yourself
                in the Bolus tab.
              </Text>
            </View>
          )}

          <View style={styles.macroGrid}>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>CAL</Text>
              <Text style={styles.macroVal}>{show(calories)}</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>CARBS</Text>
              <Text style={styles.macroVal}>{show(carbs, "g")}</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>PROTEIN</Text>
              <Text style={styles.macroVal}>{show(protein, "g")}</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>FAT</Text>
              <Text style={styles.macroVal}>{show(fat, "g")}</Text>
            </View>
          </View>

          <View style={styles.bolusRow}>
            <Text style={styles.bolusLabel}>Meal Coverage Estimate</Text>
            <Text style={styles.bolusValue}>
              {mealCoverageUnits !== null ? `${mealCoverageUnits} units` : "—"}
            </Text>
          </View>
          <Text style={styles.bolusNote}>
            {icrUsed
              ? `Based on your ICR 1:${icrUsed}. Excludes BG correction — open Bolus for your full recommended dose.`
              : "Open Bolus tab for your full recommended dose."}
          </Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={goToBolusWithCarbs}
          >
            <Text style={styles.primaryBtnText}>
              {nutritionFound ? "Calculate Full Bolus" : "Enter Carbs in Bolus"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              logged && styles.loggedBtn,
              !nutritionFound && { opacity: 0.4 },
            ]}
            onPress={handleLogMeal}
            disabled={logging || logged || !nutritionFound}
          >
            {logging ? (
              <ActivityIndicator color="#7C3AED" />
            ) : (
              <Text
                style={[
                  styles.secondaryBtnText,
                  logged && styles.loggedBtnText,
                ]}
              >
                {logged ? "✓ Logged" : "Log Meal"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setResult(null);
              setImage(null);
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    );
  }

  // ——— ANALYZING VIEW ———
  if (loading) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        {image && (
          <Image source={{ uri: image }} style={styles.analyzingImage} />
        )}
        <ActivityIndicator
          size="large"
          color="#7C3AED"
          style={{ marginVertical: 20 }}
        />
        <Text style={styles.analyzingTitle}>Analyzing...</Text>
        <Text style={styles.analyzingSub}>
          GlycoVision AI is analyzing your meal
        </Text>

        <View style={{ marginTop: 30, width: "80%" }}>
          {[
            "Uploading photo",
            "Identifying the dish and looking up nutrition",
          ].map((t, i) => (
            <View key={i} style={styles.stepRow}>
              <Ionicons
                name={step > i ? "checkmark-circle" : "ellipse-outline"}
                size={20}
                color={step > i ? "#10B981" : "#D1D5DB"}
              />
              <Text style={[styles.stepText, step > i && { color: "#111" }]}>
                {t}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ——— DEFAULT SCANNER VIEW ———
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>AI Food Scanner</Text>
        <Text style={styles.subtitle}>
          Snap or upload a meal photo. GlycoVision identifies the dish and
          looks up its nutrition for a standard serving.
        </Text>
      </View>

      <TouchableOpacity style={styles.bigPrimary} onPress={takePhoto}>
        <Ionicons name="camera" size={22} color="#fff" />
        <Text style={styles.bigPrimaryText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.bigSecondary} onPress={pickImage}>
        <Ionicons name="image-outline" size={20} color="#7C3AED" />
        <Text style={styles.bigSecondaryText}>Upload</Text>
      </TouchableOpacity>

      <Text style={styles.modelNote}>GlycoVision AI · Experimental food analysis</Text>

      <Text style={styles.sectionTitle}>Popular in your region</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 12 }}
      >
        {[
          { name: "Chicken Biryani", carbs: "62g" },
          { name: "Chicken Karahi", carbs: "8g" },
          { name: "Naan", carbs: "45g" },
        ].map((f, i) => (
          <Card key={i} style={{ width: 140, marginRight: 12, padding: 14 }}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>🍛</Text>
            <Text style={{ fontWeight: "600", fontSize: 14 }}>{f.name}</Text>
            <Text style={{ color: "#6B7280", marginTop: 4 }}>{f.carbs}</Text>
          </Card>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F7FF" },
  header: { marginBottom: 24, marginTop: 40 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 15, color: "#6B7280", marginTop: 8, lineHeight: 22 },

  bigPrimary: {
    backgroundColor: "#7C3AED",
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  bigPrimaryText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  bigSecondary: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    marginBottom: 16,
  },
  bigSecondaryText: { color: "#7C3AED", fontSize: 16, fontWeight: "600" },
  modelNote: {
    textAlign: "center",
    color: "#9CA3AF",
    fontSize: 12,
    marginBottom: 28,
  },

  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },

  analyzingImage: { width: 180, height: 180, borderRadius: 20 },
  analyzingTitle: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  analyzingSub: { color: "#6B7280", marginTop: 4 },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  stepText: { fontSize: 15, color: "#9CA3AF" },

  resultImage: {
    width: "100%",
    height: 220,
    borderRadius: 20,
    marginBottom: 16,
  },
  badgeRow: { marginBottom: 10 },
  dbBadge: {
    backgroundColor: "#ECFDF5",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  dbText: { color: "#059669", fontWeight: "600", fontSize: 13 },
  foodName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 18,
  },
  servingNote: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: -12,
    marginBottom: 16,
  },
  unknownBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  unknownText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: "#92400E",
  },
  macroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  // Two tiles per row. A width computed from the screen size ignored the
  // card and page padding, so tiles wrapped one per row.
  macroBox: {
    flexGrow: 1,
    flexBasis: "40%",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    padding: 12,
  },
  macroLabel: { fontSize: 11, color: "#6B7280", fontWeight: "600" },
  macroVal: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  bolusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bolusLabel: { fontSize: 15, fontWeight: "600" },
  bolusValue: { fontSize: 22, fontWeight: "700", color: "#7C3AED" },
  bolusNote: { fontSize: 12, color: "#9CA3AF", marginTop: 4, marginBottom: 20 },
  primaryBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryBtnText: { color: "#374151", fontWeight: "600" },
  loggedBtn: { borderColor: "#10B981", backgroundColor: "#ECFDF5" },
  loggedBtnText: { color: "#059669" },
  retryBtn: { paddingVertical: 10, alignItems: "center" },
  retryBtnText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },
});
