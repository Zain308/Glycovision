// app/(tabs)/scanner.tsx
//
// Meal scanner: photo -> dish -> carbs (the hero number, because it drives
// the insulin estimate) -> portion -> actions. When the model is unsure the
// user picks from its top guesses instead of seeing "no food".
import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Text } from "@/components/ui/Typography";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  DishSuggestion,
  analyzeMeal,
  getDishNutrition,
  getProfile,
  logMeal,
} from "@/services/api";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { IconBadge, ListRow, SectionHeader } from "@/components/ui/Bits";
import { ResearchNote } from "@/components/ui/ResearchNote";
import { PortionPicker } from "@/components/PortionPicker";
import { ScanPhoto } from "@/components/ScanPhoto";
import { NotificationBell } from "@/components/NotificationBell";
import { AnimatedNumber } from "@/components/ui/Motion";
import { onMealLogged } from "@/lib/notifications";
import { haptic } from "@/lib/haptics";
import { isDisconnected, isOffline } from "@/lib/offline";
import { colors, radius, tabular } from "@/constants/theme";
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
  // The model's guesses when it was not sure which dish this is.
  const [suggestions, setSuggestions] = useState<DishSuggestion[] | null>(null);

  // Show an analysis result: portion, then the ICR for the dose estimate.
  const showResult = async (data: any) => {
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
  };

  const offerLibrary = () =>
    Alert.alert("Photo scan needs internet", "Pick the dish from the food library instead. It works without internet.", [
      { text: "Not now", style: "cancel" },
      { text: "Open food library", onPress: () => router.push("/library") },
    ]);

  const processImage = async (uri: string, mimeType?: string | null) => {
    setImage(uri);
    setLoading(true);
    setResult(null);
    setSuggestions(null);
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
      if (data.suggestions?.length) {
        setSuggestions(data.suggestions);
        return;
      }
      if (!data.ai_found || data.ai_found.length === 0) {
        Alert.alert(
          "No food detected",
          "This photo doesn't look like it contains food. Try again with a clearer meal photo.",
        );
        setImage(null);
        return;
      }
      await showResult(data);
    } catch (e: any) {
      if (isOffline(e)) {
        setImage(null);
        offerLibrary();
        return;
      }
      console.error("Scan failed:", e.message || e);
      Alert.alert("Error", e.message || "Could not reach the backend. Check IP & server.");
    } finally {
      setLoading(false);
    }
  };

  const chooseSuggestion = async (choice: DishSuggestion) => {
    setLoading(true);
    setStep(2);
    try {
      const data = await getDishNutrition(choice);
      setSuggestions(null);
      await showResult(data);
    } catch (e: any) {
      console.error("Dish lookup failed:", e.message || e);
      Alert.alert("Error", "Could not load this dish. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const takePhoto = async () => {
    if (isDisconnected()) return offerLibrary();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed");
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: true,
    });
    if (!res.canceled) processImage(res.assets[0].uri, res.assets[0].mimeType);
  };

  const pickImage = async () => {
    if (isDisconnected()) return offerLibrary();
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
      haptic.success();
      // Reminder to check sugar 2 hours after this meal.
      onMealLogged(name);
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
    const nutrientSource: string | undefined = item.nutrients?.source;

    return (
      <Screen title="Your meal">
        {image && (
          <View style={styles.photoWrap}>
            <Image source={{ uri: image }} style={styles.resultImage} accessibilityIgnoresInvertColors />
            {confidencePct !== null && (
              <View style={styles.photoChip}>
                <Ionicons name="sparkles" size={14} color="#fff" />
                <Text style={styles.photoChipText}>{confidencePct}% sure</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.foodName} accessibilityRole="header">
          {item.food_name || "Detected meal"}
        </Text>

        {!nutritionFound ? (
          <Card variant="flat" style={styles.unknownBox}>
            <IconBadge icon="alert-circle" tone="warning" />
            <View style={{ flex: 1 }}>
              <Text style={styles.unknownTitle}>Carbs unknown for this dish</Text>
              <Text style={styles.unknownText}>
                We recognised it but have no trusted nutrition data yet. Check a label or food guide,
                then enter the carbs yourself in Bolus.
              </Text>
            </View>
          </Card>
        ) : (
          <>
            {portion && portionGrams !== null && (
              <PortionPicker portion={portion} grams={portionGrams} onChange={changePortion} />
            )}

            {/* Carbs first: it drives the insulin estimate. */}
            <Card variant="hero" style={styles.carbHero}>
              <Text style={styles.carbLabel}>CARBS</Text>
              <View style={styles.carbRow}>
                <AnimatedNumber value={carbs} style={styles.carbValue} />
                <Text style={styles.carbUnit}>g</Text>
              </View>
              {meal?.label ? <Text style={styles.carbFor}>for {meal.label}</Text> : null}

              {/* Where the energy comes from: carbs / protein / fat (by calories) */}
              {carbs !== null && protein !== null && fat !== null && carbs + protein + fat > 0 ? (
                <View style={styles.splitWrap}>
                  <View style={styles.splitBar}>
                    {[
                      { k: "c", v: carbs * 4, c: colors.carbs },
                      { k: "p", v: protein * 4, c: colors.success },
                      { k: "f", v: fat * 9, c: colors.primary },
                    ].map((s) => (
                      <View key={s.k} style={{ flex: Math.max(s.v, 0.01), backgroundColor: s.c }} />
                    ))}
                  </View>
                  <View style={styles.splitLegend}>
                    {[
                      { l: "Carbs", c: colors.carbs },
                      { l: "Protein", c: colors.success },
                      { l: "Fat", c: colors.primary },
                    ].map((s) => (
                      <View key={s.l} style={styles.splitItem}>
                        <View style={[styles.splitDot, { backgroundColor: s.c }]} />
                        <Text style={styles.splitText}>{s.l}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.macroRow}>
                {[
                  { l: "Calories", v: show(calories) },
                  { l: "Protein", v: show(protein, " g") },
                  { l: "Fat", v: show(fat, " g") },
                ].map((m) => (
                  <View key={m.l} style={styles.macroBox}>
                    <Text style={styles.macroVal}>{m.v}</Text>
                    <Text style={styles.macroLabel}>{m.l}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card variant="tint">
              <View style={styles.coverRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.coverLabel}>Insulin for this meal</Text>
                  <Text style={styles.coverNote}>
                    {icrUsed
                      ? `Carbs ÷ your ratio 1:${icrUsed}. Excludes correction for high sugar.`
                      : "Open Bolus for your full estimate."}
                  </Text>
                </View>
                <View style={styles.coverValueRow}>
                  <AnimatedNumber value={mealCoverageUnits} decimals={1} style={styles.coverValue} />
                  <Text style={styles.coverUnit}> u</Text>
                </View>
              </View>
            </Card>

            {nutrientSource ? (
              <ResearchNote label="Where these numbers come from" details={nutrientSource} />
            ) : null}
          </>
        )}

        <View style={styles.actions}>
          <Button
            label={nutritionFound ? "Calculate my dose" : "Enter carbs in Bolus"}
            icon="calculator"
            onPress={goToBolusWithCarbs}
          />
          {nutritionFound && (
            <Button
              label={logged ? "Meal logged" : "Log this meal"}
              icon={logged ? "checkmark-circle" : "add-circle-outline"}
              variant={logged ? "success" : "secondary"}
              onPress={handleLogMeal}
              loading={logging}
              disabled={logged}
            />
          )}
          {logged ? (
            <Button label="See what it does to my sugar" icon="trending-up" variant="secondary" onPress={() => router.push("/(tabs)")} />
          ) : null}
          <Button
            label="Scan another meal"
            icon="camera-outline"
            variant="ghost"
            onPress={() => {
              setResult(null);
              setImage(null);
            }}
          />
        </View>
      </Screen>
    );
  }

  // ——— NOT SURE VIEW: let the user pick the dish ———
  if (suggestions && !loading) {
    return (
      <Screen title="Which dish is this?" subtitle="We're not sure. Tap the right one.">
        {image && <Image source={{ uri: image }} style={styles.resultImage} />}

        <Card>
          {suggestions.map((s, i) => (
            <View key={s.food_name}>
              {i > 0 && <View style={styles.divider} />}
              <ListRow
                icon="restaurant"
                tone={i === 0 ? "brand" : "neutral"}
                title={s.display_name}
                detail={i === 0 ? "Best guess" : undefined}
                onPress={() => chooseSuggestion(s)}
              />
            </View>
          ))}
        </Card>

        <Button
          label="None of these – retake photo"
          icon="camera-outline"
          variant="secondary"
          onPress={() => {
            setSuggestions(null);
            setImage(null);
          }}
        />
        <Text style={styles.tipLine}>Tip: shoot from above, in good light, one dish at a time.</Text>
      </Screen>
    );
  }

  // ——— ANALYZING VIEW ———
  if (loading) {
    return (
      <Screen scroll={false} contentStyle={{ alignItems: "center", justifyContent: "center" }}>
        {image ? <ScanPhoto uri={image} /> : <ActivityIndicator size="large" color={colors.primary} />}
        <Text style={[styles.analyzingTitle, { marginTop: 26 }]}>Looking at your food…</Text>
        <Text style={styles.analyzingSub}>This takes a few seconds</Text>

        <View style={styles.steps}>
          {["Uploading photo", "Finding the dish and its nutrition"].map((t, i) => (
            <View key={i} style={styles.stepRow}>
              <Ionicons
                name={step > i ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={step > i ? colors.success : colors.border}
              />
              <Text style={[styles.stepText, step > i && { color: colors.text }]}>{t}</Text>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  // ——— DEFAULT SCANNER VIEW ———
  return (
    <Screen title="Scan your meal" subtitle="Take a photo and GlycoVision finds the dish and its carbs." right={<NotificationBell />}>
      <Card variant="hero" style={styles.cameraCard}>
        <View style={styles.cameraIcon}>
          <Ionicons name="scan" size={40} color={colors.primary} />
        </View>
        <Text style={styles.cameraTitle}>Point at your plate</Text>
        <Text style={styles.cameraSub}>Works for 70 Pakistani and everyday dishes.</Text>
        <View style={{ alignSelf: "stretch", gap: 10, marginTop: 18 }}>
          <Button label="Take photo" icon="camera" variant="onHero" onPress={takePhoto} />
          <Button label="Choose from gallery" icon="images-outline" variant="onHeroOutline" onPress={pickImage} />
        </View>
      </Card>

      <SectionHeader title="For the best result" />
      <Card>
        {[
          { icon: "sunny-outline" as const, t: "Good light", d: "Daylight or a bright room" },
          { icon: "scan-outline" as const, t: "From above", d: "Fill the frame with the plate" },
          { icon: "restaurant-outline" as const, t: "One dish at a time", d: "Scan each dish of a thali separately" },
        ].map((tip, i) => (
          <View key={tip.t}>
            {i > 0 && <View style={styles.divider} />}
            <ListRow icon={tip.icon} title={tip.t} detail={tip.d} />
          </View>
        ))}
      </Card>

      <Card variant="flat">
        <ListRow
          icon="book-outline"
          title="Food library"
          detail="Look up carbs without a photo"
          onPress={() => router.push("/library")}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Result
  photoWrap: { marginBottom: 16 },
  resultImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    maxHeight: 280,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 16,
  },
  photoChip: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(15,27,45,0.7)",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  photoChipText: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  foodName: { fontSize: 30, fontWeight: "800", color: colors.text, marginBottom: 16, letterSpacing: -0.4 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: 12 },

  unknownBox: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  unknownTitle: { fontSize: 16.5, fontWeight: "800", color: colors.text },
  unknownText: { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginTop: 4 },

  carbHero: { padding: 22 },
  carbLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 1, color: colors.heroMuted },
  carbRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  carbValue: { fontSize: 60, fontWeight: "800", color: colors.heroText, letterSpacing: -2, ...tabular },
  carbUnit: { fontSize: 22, fontWeight: "700", color: colors.heroMuted },
  carbFor: { fontSize: 15, color: colors.heroMuted, marginTop: 2 },
  macroRow: { flexDirection: "row", gap: 8, marginTop: 18 },
  macroBox: {
    flex: 1,
    backgroundColor: colors.heroRaised,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  macroVal: { fontSize: 18, fontWeight: "800", color: colors.heroText, ...tabular },
  macroLabel: { fontSize: 13, color: colors.heroMuted, marginTop: 2 },

  coverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  coverLabel: { fontSize: 16.5, fontWeight: "800", color: colors.text },
  coverNote: { fontSize: 13.5, color: colors.textMuted, marginTop: 3, lineHeight: 19 },
  coverValueRow: { flexDirection: "row", alignItems: "baseline" },
  coverValue: { fontSize: 32, fontWeight: "800", color: colors.primary, ...tabular },
  splitWrap: { marginTop: 16, gap: 8 },
  splitBar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 },
  splitLegend: { flexDirection: "row", gap: 14 },
  splitItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  splitDot: { width: 9, height: 9, borderRadius: 5 },
  splitText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  analyzingSub: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  coverUnit: { fontSize: 16, fontWeight: "700", color: colors.textMuted },

  actions: { gap: 10, marginTop: 8 },

  divider: { height: 1, backgroundColor: colors.divider },
  tipLine: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 14 },

  // Analyzing
  analyzingImage: { width: 200, height: 200, borderRadius: radius.xl },
  analyzingTitle: { fontSize: 22, fontWeight: "800", color: colors.text },
  steps: { marginTop: 26, gap: 14, alignSelf: "stretch", paddingHorizontal: 30 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepText: { fontSize: 16, color: colors.textFaint, fontWeight: "600" },

  // Default
  cameraCard: { alignItems: "center", padding: 24, borderRadius: radius.xl, marginBottom: 16 },
  cameraIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.heroRaised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  cameraTitle: { fontSize: 22, fontWeight: "800", color: colors.heroText },
  cameraSub: { fontSize: 15, color: colors.heroMuted, marginTop: 4, textAlign: "center" },
  takeBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
