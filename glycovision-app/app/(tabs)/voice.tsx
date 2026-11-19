import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useMemo, useState } from "react";

import {
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { Text } from "@/components/ui/Typography";

import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";

import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";

import { Card } from "@/components/ui/Card";
import {
  BASE_URL,
  getStressPattern,
  getVoiceHistory,
  type StressContext,
  type StressPattern,
} from "@/services/api";
import { StressPatternCard } from "@/components/StressPatternCard";
import { onStressCheck } from "@/lib/notifications";
import { router } from "expo-router";
import { StressContextCard } from "@/components/StressContextCard";
import { ResearchNote } from "@/components/ui/ResearchNote";
import { supabase } from "@/lib/supabase";

import { colors, spacing, radius, type } from "@/constants/theme";

const MIN_RECORDING_SECONDS = 4;
const RECOMMENDED_RECORDING_SECONDS = 8;
const IDEAL_RECORDING_SECONDS = 12;

// ---------------------------------------------------------
// TYPES
// ---------------------------------------------------------

type VoiceFeatureComparison = {
  feature?: string;
  current_value?: number;
  baseline_median?: number;
  baseline_mad?: number;
  deviation_score?: number;
  level?: "similar" | "mildly_different" | "different" | string;
};

type PersonalComparison = {
  status?: string;
  comparison_ready?: boolean;
  pattern?: "similar" | "mildly_different" | "different" | string | null;
  overall_deviation_score?: number;
  feature_comparisons?: VoiceFeatureComparison[];
  baseline_sample_count?: number;
  model_status?: string;
  interpretation?: string;
  disclaimer?: string;
  reason?: string;
};

type BaselineRefresh = {
  status?: string;
  sample_count?: number;
  required_samples?: number;
  remaining_samples?: number;
};

type VoiceResult = {
  // What this check means for the user (backend services/stress_context).
  stress_context?: StressContext | null;
  stress_score?: number;
  acoustic_score?: number;

  quality?: "good" | "acceptable" | "limited" | string;

  f0_mean?: number;
  f0_std?: number;
  jitter?: number;
  shimmer?: number;
  hnr?: number;
  voiced_ratio?: number;

  interpretation?: string;
  model_status?: string;
  disclaimer?: string;

  personal_comparison?: PersonalComparison;
  baseline_refresh?: BaselineRefresh;
};

type VoiceHistoryItem = {
  id: string;
  stress_score?: number | null;
  acoustic_score?: number | null;
  f0_mean?: number | null;
  f0_std?: number | null;
  jitter?: number | null;
  shimmer?: number | null;
  hnr?: number | null;
  voiced_ratio?: number | null;
  quality?: string | null;
  model_status?: string | null;
  logged_at?: string | null;
};

type VoiceHistoryResponse = {
  status?: string;
  count?: number;
  history?: VoiceHistoryItem[];
};

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMetric(value: unknown, decimals = 1) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return "—";
  }

  return parsed.toFixed(decimals);
}

function formatHistoryDate(value?: string | null) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFeatureDisplayName(feature?: string) {
  switch (feature) {
    case "f0_mean":
      return "Average pitch";
    case "f0_std":
      return "Pitch variation";
    case "hnr":
      return "Voice clarity";
    case "voiced_ratio":
      return "Voiced signal";
    default:
      return feature || "Acoustic feature";
  }
}

function getComparisonLevelLabel(level?: string | null) {
  switch (level) {
    case "similar":
      return "Similar";
    case "mildly_different":
      return "Mildly different";
    case "different":
      return "Different";
    default:
      return "Unavailable";
  }
}

function getPatternTitle(pattern?: string | null) {
  switch (pattern) {
    case "similar":
      return "Similar to your usual pattern";
    case "mildly_different":
      return "Slightly different from your usual pattern";
    case "different":
      return "Different from your usual pattern";
    default:
      return "Personal comparison";
  }
}

// ---------------------------------------------------------
// VOICE SCREEN
// ---------------------------------------------------------

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const recorderState = useAudioRecorderState(recorder);
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<VoiceResult | null>(null);

  const [history, setHistory] = useState<VoiceHistoryItem[]>([]);

  const [historyLoading, setHistoryLoading] = useState(false);

  const [historyError, setHistoryError] = useState<string | null>(null);

  // Technical acoustic numbers are hidden until the user asks for them.
  const [showDetails, setShowDetails] = useState(false);

  const loadVoiceHistory = async () => {
    setHistoryLoading(true);

    setHistoryError(null);

    try {
      const historyData: VoiceHistoryResponse = await getVoiceHistory(10);

      const rows = Array.isArray(historyData?.history)
        ? historyData.history
        : [];

      setHistory(rows);

    } catch (error: any) {
      console.error("[Voice] History load failed:", error?.message ?? error);

      setHistoryError(
        error?.message || "Could not load recent voice checks.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  // -------------------------------------------------------
  // MICROPHONE SETUP
  // -------------------------------------------------------

  // Returns true only when the microphone is usable. Called on screen
  // load and again before every recording, so a user who denied access
  // is asked again (or sent to Settings) instead of hitting a silent error.
  const ensureMicReady = async (): Promise<boolean> => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Microphone permission needed",
          "GlycoVision needs microphone access to perform the acoustic voice check.",
          permission.canAskAgain
            ? [{ text: "OK" }]
            : [
                { text: "Cancel", style: "cancel" },
                { text: "Open Settings", onPress: () => Linking.openSettings() },
              ],
        );

        return false;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      return true;
    } catch (error) {
      console.error("[Voice] Audio setup failed:", error);
      return false;
    }
  };

  useEffect(() => {
    ensureMicReady();
  }, []);

  // Stress over the last 7 days and its effect on this user's sugar.
  const [pattern, setPattern] = useState<StressPattern | null>(null);
  const loadPattern = () =>
    getStressPattern()
      .then(setPattern)
      .catch((error) => console.log("[Voice] Stress pattern unavailable:", error?.message));

  useEffect(() => {
    loadVoiceHistory();
    loadPattern();
  }, []);

  // -------------------------------------------------------
  // START RECORDING
  // -------------------------------------------------------

  const startRecording = async () => {
    try {
      if (!(await ensureMicReady())) {
        return;
      }

      setResult(null);
      setShowDetails(false);

      await recorder.prepareToRecordAsync();

      recorder.record();
    } catch (error) {
      console.error("[Voice] Could not start recording:", error);

      Alert.alert("Recording error", "Could not start microphone recording.");
    }
  };

  // -------------------------------------------------------
  // STOP + ANALYZE
  // -------------------------------------------------------

  const stopRecording = async () => {
    if (loading) {
      return;
    }

    setLoading(true);

    try {
      const durationSeconds = recorderState.durationMillis / 1000;

      await recorder.stop();

      if (durationSeconds < MIN_RECORDING_SECONDS) {
        throw new Error(
          `Please speak naturally for at least ${MIN_RECORDING_SECONDS} seconds.`,
        );
      }

      const uri = recorder.uri;

      if (!uri) {
        throw new Error("Recording file was not created.");
      }

      const audioFile = new File(uri);

      if (!audioFile.exists) {
        throw new Error("Recorded audio file does not exist.");
      }

      if (!audioFile.size || audioFile.size <= 0) {
        throw new Error("The recording is empty. Please record again.");
      }

      // -----------------------------------------------
      // AUTH
      // -----------------------------------------------

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error("Could not verify your login session.");
      }

      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Your login session expired. Please log in again.");
      }

      // -----------------------------------------------
      // MULTIPART AUDIO
      // -----------------------------------------------

      const endpoint = `${BASE_URL}/api/v1/stress-analyze`;

      console.log("[Voice Upload] Starting upload");
      console.log("[Voice Upload] URI:", uri);
      console.log("[Voice Upload] File size:", audioFile.size);
      console.log("[Voice Upload] Endpoint:", endpoint);

      // Use Expo's explicit multipart uploader. This avoids the
      // FormData/File compatibility issues seen with fetch on Android.
      const uploadResult = await FileSystem.uploadAsync(endpoint, uri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: "audio/mp4",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("[Voice Upload] HTTP status:", uploadResult.status);
      console.log("[Voice Upload] Raw response:", uploadResult.body);

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(
          `Voice analysis failed (${uploadResult.status}): ${uploadResult.body}`,
        );
      }

      let dataResult: VoiceResult;

      try {
        dataResult = JSON.parse(uploadResult.body) as VoiceResult;
      } catch {
        throw new Error(
          "The server returned an invalid voice-analysis response.",
        );
      }

      console.log("[Voice] Analysis:", dataResult);

      setResult(dataResult);

      // A stressed check schedules one sugar recheck in 90 minutes.
      onStressCheck(dataResult.stress_context?.level).catch(() => {});
      loadPattern();

      // The backend saves the result before returning,
      // so refresh history immediately after analysis.
      await loadVoiceHistory();
    } catch (error: any) {
      console.error("[Voice] Analysis failed FULL ERROR:", error);
      console.error("[Voice] Error message:", error?.message);
      console.error("[Voice] Error stack:", error?.stack);

      Alert.alert(
        "Voice analysis",
        error?.message || "Could not analyze this recording.",
      );
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------
  // TIMER
  // -------------------------------------------------------

  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);

    const minutes = Math.floor(totalSeconds / 60);

    const seconds = totalSeconds % 60;

    return (
      `${minutes.toString().padStart(2, "0")}:` +
      `${seconds.toString().padStart(2, "0")}`
    );
  };

  const isRecording = recorderState.isRecording;

  const durationSeconds = recorderState.durationMillis / 1000;

  const durationProgress = Math.min(
    durationSeconds / IDEAL_RECORDING_SECONDS,
    1,
  );

  // -------------------------------------------------------
  // RESULT HELPERS
  // -------------------------------------------------------

  const acousticScore = useMemo(() => {
    if (!result) {
      return 0;
    }

    const score = result.acoustic_score ?? result.stress_score ?? 0;

    return Math.max(0, Math.min(1, safeNumber(score)));
  }, [result]);

  const scorePercent = Math.round(acousticScore * 100);

  const qualityLabel = useMemo(() => {
    const quality = String(result?.quality ?? "").toLowerCase();

    if (quality === "good") {
      return "Good signal";
    }

    if (quality === "acceptable") {
      return "Acceptable signal";
    }

    if (quality === "limited") {
      return "Limited signal";
    }

    return "Signal analyzed";
  }, [result]);

  const qualityStyle = useMemo(() => {
    const quality = String(result?.quality ?? "").toLowerCase();

    if (quality === "good") {
      return {
        box: styles.qualityGood,
        text: styles.qualityGoodText,
      };
    }

    if (quality === "acceptable") {
      return {
        box: styles.qualityAcceptable,
        text: styles.qualityAcceptableText,
      };
    }

    return {
      box: styles.qualityLimited,
      text: styles.qualityLimitedText,
    };
  }, [result]);

  const isLimitedResult =
    String(result?.quality ?? "").toLowerCase() === "limited";

  const recordingHint = useMemo(() => {
    if (!isRecording) {
      return "Speak naturally for about 8–15 seconds. You can say anything you like.";
    }

    if (durationSeconds < MIN_RECORDING_SECONDS) {
      return `Keep speaking naturally — ${Math.ceil(
        MIN_RECORDING_SECONDS - durationSeconds,
      )}s more for a usable sample.`;
    }

    if (durationSeconds < RECOMMENDED_RECORDING_SECONDS) {
      return "Usable sample. Keep speaking a little longer for a stronger recording.";
    }

    if (durationSeconds < 15) {
      return "Great sample length. You can stop and analyze whenever you're ready.";
    }

    return "That's enough speech for this check. You can stop and analyze now.";
  }, [isRecording, durationSeconds]);

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* HEADER */}

      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="mic-outline" size={22} color={colors.primary} />
        </View>

        <View
          style={{
            flex: 1,
          }}
        >
          <Text style={styles.title} accessibilityRole="header">Voice check</Text>

          <Text style={styles.subtitle}>
            Speak naturally for a short acoustic check — no fixed phrase
            required.
          </Text>
        </View>
      </View>

      {/* HOW TO RECORD */}

      <Card style={styles.instructionsCard}>
        <Text style={styles.sectionTitle}>Before you record</Text>

        <View style={styles.steps}>
          <InstructionStep number="1" text="Move to a quiet place." />

          <InstructionStep
            number="2"
            text="Speak naturally. You can talk about your day, your meal, or anything you like."
          />

          <InstructionStep
            number="3"
            text="Speak for about 8–15 seconds and keep your phone at a comfortable, consistent distance."
          />
        </View>
      </Card>

      {/* RECORDING CARD */}

      <Card style={styles.recordCard}>
        <View style={[styles.micOuter, isRecording && styles.micOuterActive]}>
          <View style={[styles.micCircle, isRecording && styles.micActive]}>
            <Ionicons
              name={isRecording ? "mic" : "mic-outline"}
              size={42}
              color={isRecording ? "#EF4444" : colors.primary}
            />
          </View>
        </View>

        <Text style={styles.timer}>
          {formatTime(recorderState.durationMillis)}
        </Text>

        <Text
          style={[
            styles.recordingStatus,

            isRecording && styles.recordingStatusActive,
          ]}
        >
          {isRecording ? "Recording" : "Ready to record"}
        </Text>

        <Text style={styles.recordingHint}>{recordingHint}</Text>

        <View style={styles.durationTrack}>
          <View
            style={[
              styles.durationFill,
              {
                width: `${durationProgress * 100}%`,
              },
            ]}
          />
        </View>

        <View style={styles.durationLabels}>
          <Text style={styles.durationLabel}>0s</Text>

          <Text style={styles.durationLabel}>4s minimum</Text>

          <Text style={styles.durationLabel}>12s ideal</Text>
        </View>

        {loading ? (
          <View style={styles.loadingArea}>
            <ActivityIndicator size="large" color={colors.primary} />

            <Text style={styles.loadingTitle}>Analyzing acoustic features</Text>

            <Text style={styles.loadingText}>
              Analyzing pitch variation, harmonic quality and usable voiced
              speech.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.recordBtn, isRecording && styles.stopBtn]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <Ionicons
              name={isRecording ? "stop" : "mic"}
              size={20}
              color="#fff"
            />

            <Text style={styles.recordBtnText}>
              {isRecording ? "Stop & Analyze" : "Start Voice Check"}
            </Text>
          </TouchableOpacity>
        )}
      </Card>

      {/* WHAT THIS MEANS (stress context) */}

      {result?.stress_context && result.quality !== "limited" && (
        <Card style={styles.resultCard}>
          <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>
            What this means for you
          </Text>
          <StressContextCard
            context={result.stress_context}
            onLogBg={() =>
              router.push({ pathname: "/(tabs)", params: { logBg: "1" } })
            }
            onOpenBolus={() => router.push("/(tabs)/bolus")}
          />
        </Card>
      )}

      {/* STRESS OVER TIME */}

      {pattern && (
        <Card style={styles.resultCard}>
          <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>
            Your stress pattern
          </Text>
          <StressPatternCard data={pattern} />
        </Card>
      )}

      {/* RESULT */}

      {result && (
        <Card style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <View>
              <Text style={styles.sectionTitle}>Acoustic Analysis</Text>

              <Text style={styles.resultSubtitle}>Latest voice sample</Text>
            </View>

            <View style={[styles.qualityBadge, qualityStyle.box]}>
              <Ionicons
                name="checkmark-circle-outline"
                size={14}
                color={qualityStyle.text.color}
              />

              <Text style={[styles.qualityBadgeText, qualityStyle.text]}>
                {qualityLabel}
              </Text>
            </View>
          </View>

          {/* SCORE / RELIABILITY */}

          {isLimitedResult ? (
            <View style={styles.limitedResultBox}>
              <View style={styles.limitedIcon}>
                <Ionicons name="warning-outline" size={24} color="#DC2626" />
              </View>

              <Text style={styles.limitedTitle}>Low-confidence recording</Text>

              <Text style={styles.limitedText}>
                The acoustic signal was not reliable enough to emphasize a
                variability score. Try again in a quieter place, keep the phone
                at a consistent distance, and speak naturally for 8–15 seconds.
              </Text>

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.retryBtn}
                onPress={startRecording}
              >
                <Ionicons name="refresh-outline" size={18} color="#fff" />

                <Text style={styles.retryBtnText}>Record Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.scoreSection}>
              <View style={styles.scoreCircle}>
                <Text style={styles.scoreValue}>{scorePercent}</Text>

                <Text style={styles.scorePercent}>%</Text>
              </View>

              <Text style={styles.scoreLabel}>Voice variability</Text>

              <Text style={styles.scoreHelper}>
                How much your pitch and voice quality varied in this
                recording. It is not a stress percentage.
              </Text>

              <View style={styles.scoreTrack}>
                <View
                  style={[
                    styles.scoreTrackFill,
                    {
                      width: `${scorePercent}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.detailsToggle}
            onPress={() => setShowDetails((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
          >
            <Text style={styles.detailsToggleText}>
              {showDetails ? "Hide technical details" : "Show technical details"}
            </Text>
            <Ionicons
              name={showDetails ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.primary}
            />
          </TouchableOpacity>

          {showDetails && (
          <>
          {/* FEATURE TRACKS */}

          <Text style={styles.featureHeading}>Acoustic feature tracks</Text>

          <Text style={styles.featureSubheading}>
            A simple view of the main characteristics detected in this
            recording.
          </Text>

          <FeatureTrack
            icon="musical-notes-outline"
            label="Average pitch"
            value={formatMetric(result.f0_mean, 1)}
            unit="Hz"
            helper="Average fundamental frequency (F0)."
          />

          <FeatureTrack
            icon="pulse-outline"
            label="Pitch variation"
            value={formatMetric(result.f0_std, 1)}
            unit="Hz"
            helper="Variation of F0 across the voiced sample."
          />

          <FeatureTrack
            icon="volume-high-outline"
            label="HNR"
            value={formatMetric(result.hnr, 2)}
            unit="dB"
            helper="A descriptive measure of harmonic quality in the recording."
          />

          <FeatureTrack
            icon="radio-outline"
            label="Voiced signal"
            value={
              result.voiced_ratio != null
                ? `${Math.round(safeNumber(result.voiced_ratio) * 100)}`
                : "—"
            }
            unit="%"
            helper="How much of the recording contained usable voiced speech."
          />

          {/* INTERPRETATION */}

          <View style={styles.interpretationBox}>
            <Ionicons
              name="sparkles-outline"
              size={20}
              color={colors.primary}
            />

            <View
              style={{
                flex: 1,
              }}
            >
              <Text style={styles.interpretationTitle}>Result summary</Text>

              <Text style={styles.interpretation}>
                {result.interpretation ?? "Acoustic analysis completed."}
              </Text>
            </View>
          </View>

          {/* PERSONAL PATTERN COMPARISON */}

          {result.personal_comparison && (
            <View style={styles.personalComparisonSection}>
              <View style={styles.personalComparisonHeader}>
                <View style={styles.personalComparisonIcon}>
                  <Ionicons
                    name="analytics-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.personalComparisonTitle}>
                    Personal acoustic pattern
                  </Text>

                  <Text style={styles.personalComparisonSubtitle}>
                    Compared with your recent valid voice recordings.
                  </Text>
                </View>
              </View>

              {result.personal_comparison.comparison_ready ? (
                <>
                  <View
                    style={[
                      styles.patternSummaryBox,
                      result.personal_comparison.pattern === "different"
                        ? styles.patternDifferentBox
                        : result.personal_comparison.pattern ===
                            "mildly_different"
                          ? styles.patternMildBox
                          : styles.patternSimilarBox,
                    ]}
                  >
                    <Ionicons
                      name={
                        result.personal_comparison.pattern === "different"
                          ? "alert-circle-outline"
                          : result.personal_comparison.pattern ===
                              "mildly_different"
                            ? "swap-horizontal-outline"
                            : "checkmark-circle-outline"
                      }
                      size={23}
                      color={
                        result.personal_comparison.pattern === "different"
                          ? "#B91C1C"
                          : result.personal_comparison.pattern ===
                              "mildly_different"
                            ? "#B45309"
                            : "#15803D"
                      }
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={styles.patternSummaryTitle}>
                        {getPatternTitle(
                          result.personal_comparison.pattern,
                        )}
                      </Text>

                      <Text style={styles.patternSummaryText}>
                        {result.personal_comparison.interpretation ??
                          "Personal acoustic comparison completed."}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.comparisonStatsRow}>
                    <View style={styles.comparisonStatBox}>
                      <Text style={styles.comparisonStatValue}>
                        {formatMetric(
                          result.personal_comparison
                            .overall_deviation_score,
                          2,
                        )}
                      </Text>

                      <Text style={styles.comparisonStatLabel}>
                        Deviation score
                      </Text>
                    </View>

                    <View style={styles.comparisonStatBox}>
                      <Text style={styles.comparisonStatValue}>
                        {result.personal_comparison.baseline_sample_count ?? "—"}
                      </Text>

                      <Text style={styles.comparisonStatLabel}>
                        Baseline samples
                      </Text>
                    </View>
                  </View>

                  {Array.isArray(
                    result.personal_comparison.feature_comparisons,
                  ) &&
                    result.personal_comparison.feature_comparisons.length >
                      0 && (
                      <View style={styles.comparisonFeatures}>
                        <Text style={styles.comparisonFeaturesTitle}>
                          Compared features
                        </Text>

                        {result.personal_comparison.feature_comparisons.map(
                          (feature, index) => {
                            const level = String(
                              feature.level ?? "",
                            ).toLowerCase();

                            return (
                              <View
                                key={`${feature.feature}-${index}`}
                                style={[
                                  styles.comparisonFeatureRow,
                                  index ===
                                    result.personal_comparison!
                                      .feature_comparisons!.length -
                                      1 &&
                                    styles.comparisonFeatureRowLast,
                                ]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={styles.comparisonFeatureName}
                                  >
                                    {getFeatureDisplayName(feature.feature)}
                                  </Text>

                                  <Text
                                    style={styles.comparisonFeatureDetail}
                                  >
                                    Deviation{" "}
                                    {formatMetric(
                                      feature.deviation_score,
                                      2,
                                    )}
                                  </Text>
                                </View>

                                <View
                                  style={[
                                    styles.comparisonLevelBadge,
                                    level === "different"
                                      ? styles.comparisonLevelDifferent
                                      : level === "mildly_different"
                                        ? styles.comparisonLevelMild
                                        : styles.comparisonLevelSimilar,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.comparisonLevelText,
                                      level === "different"
                                        ? styles.comparisonLevelDifferentText
                                        : level === "mildly_different"
                                          ? styles.comparisonLevelMildText
                                          : styles.comparisonLevelSimilarText,
                                    ]}
                                  >
                                    {getComparisonLevelLabel(feature.level)}
                                  </Text>
                                </View>
                              </View>
                            );
                          },
                        )}
                      </View>
                    )}

                  <Text style={styles.personalComparisonDisclaimer}>
                    {result.personal_comparison.disclaimer ??
                      "Experimental personal acoustic comparison only. This is not a diagnosis and must not be used to determine or change insulin dosing."}
                  </Text>
                </>
              ) : (
                <View style={styles.comparisonUnavailableBox}>
                  <Ionicons
                    name="information-circle-outline"
                    size={22}
                    color={colors.textMuted}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.comparisonUnavailableTitle}>
                      Personal comparison unavailable
                    </Text>

                    <Text style={styles.comparisonUnavailableText}>
                      {result.personal_comparison.reason ??
                        "This recording could not be compared with your personal acoustic baseline."}
                    </Text>
                  </View>
                </View>
              )}

              {result.baseline_refresh?.status === "ready" && (
                <Text style={styles.baselineRefreshText}>
                  Current baseline:{" "}
                  {result.baseline_refresh.sample_count ?? "—"} valid
                  recordings
                </Text>
              )}
            </View>
          )}

          </>
          )}

          {/* DISCLAIMER */}

          <ResearchNote
            label="Experimental voice analysis · not a diagnosis"
            details={
              result.disclaimer ??
              "Experimental acoustic analysis only. This feature is not a clinical diagnosis and should not be used to determine insulin requirements."
            }
          />
        </Card>
      )}

      {/* RECENT VOICE CHECKS */}

      <Card style={styles.historyCard}>
        <View style={styles.historyHeader}>
          <View
            style={{
              flex: 1,
            }}
          >
            <Text style={styles.sectionTitle}>Recent Voice Checks</Text>

            <Text style={styles.historySubtitle}>
              Your latest acoustic recordings.
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.historyRefreshBtn}
            onPress={loadVoiceHistory}
            disabled={historyLoading}
          >
            {historyLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name="refresh-outline"
                size={18}
                color={colors.primary}
              />
            )}
          </TouchableOpacity>
        </View>

        {historyLoading && history.length === 0 ? (
          <View style={styles.historyLoadingArea}>
            <ActivityIndicator size="small" color={colors.primary} />

            <Text style={styles.historyEmptyText}>
              Loading recent checks...
            </Text>
          </View>
        ) : historyError && history.length === 0 ? (
          <View style={styles.historyEmptyBox}>
            <Ionicons
              name="alert-circle-outline"
              size={22}
              color={colors.textMuted}
            />

            <Text style={styles.historyEmptyTitle}>History unavailable</Text>

            <Text style={styles.historyEmptyText}>{historyError}</Text>
          </View>
        ) : history.length === 0 ? (
          <View style={styles.historyEmptyBox}>
            <Ionicons name="time-outline" size={24} color={colors.primary} />

            <Text style={styles.historyEmptyTitle}>No previous checks yet</Text>

            <Text style={styles.historyEmptyText}>
              Complete a voice check and it will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.historyList}>
            {history.map((item, index) => {
              const itemScore = item.acoustic_score ?? item.stress_score ?? 0;

              const itemPercent = Math.round(
                Math.max(0, Math.min(1, safeNumber(itemScore))) * 100,
              );

              const quality = String(item.quality ?? "analyzed").toLowerCase();

              return (
                <View
                  key={item.id || `${item.logged_at}-${index}`}
                  style={[
                    styles.historyItem,

                    index === history.length - 1 && styles.historyItemLast,
                  ]}
                >
                  <View
                    style={[
                      styles.historyScoreCircle,
                      quality === "limited" && styles.historyScoreCircleLimited,
                    ]}
                  >
                    {quality === "limited" ? (
                      <Ionicons
                        name="warning-outline"
                        size={20}
                        color="#DC2626"
                      />
                    ) : (
                      <Text style={styles.historyScoreValue}>
                        {itemPercent}%
                      </Text>
                    )}
                  </View>

                  <View style={styles.historyMain}>
                    <View style={styles.historyTopRow}>
                      <Text style={styles.historyDate}>
                        {formatHistoryDate(item.logged_at)}
                      </Text>

                      <View
                        style={[
                          styles.historyQualityBadge,

                          quality === "good"
                            ? styles.qualityGood
                            : quality === "acceptable"
                              ? styles.qualityAcceptable
                              : styles.qualityLimited,
                        ]}
                      >
                        <Text
                          style={[
                            styles.historyQualityText,

                            quality === "good"
                              ? styles.qualityGoodText
                              : quality === "acceptable"
                                ? styles.qualityAcceptableText
                                : styles.qualityLimitedText,
                          ]}
                        >
                          {quality}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.historyLabel}>Voice variability</Text>

                    <View style={styles.historyMetrics}>
                      <Text style={styles.historyMetric}>
                        Pitch {formatMetric(item.f0_mean, 1)} Hz
                      </Text>

                      <Text style={styles.historyMetricDot}>•</Text>

                      <Text style={styles.historyMetric}>
                        HNR {formatMetric(item.hnr, 1)} dB
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

// ---------------------------------------------------------
// SMALL COMPONENTS
// ---------------------------------------------------------

function InstructionStep({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>

      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function FeatureTrack({
  icon,
  label,
  value,
  unit,
  helper,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  unit: string;
  helper: string;
}) {
  return (
    <View style={styles.featureTrack}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>

      <View style={styles.featureTextArea}>
        <Text style={styles.featureLabel}>{label}</Text>

        <Text style={styles.featureHelper}>{helper}</Text>
      </View>

      <View style={styles.featureValueArea}>
        <Text style={styles.featureValue}>{value}</Text>

        <Text style={styles.featureUnit}>{unit}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------

const styles = StyleSheet.create({
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  detailsToggleText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },

  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  content: {
    paddingHorizontal: 20,
    // Room above the floating tab bar.
    paddingBottom: 140,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },

  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  title: {
    ...type.title,
  },

  subtitle: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textMuted,
  },

  sectionTitle: {
    ...type.sectionTitle,
  },

  instructionsCard: {
    marginBottom: 4,
  },

  steps: {
    marginTop: 14,
    gap: 12,
  },

  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },

  stepNumberText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
  },

  stepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    paddingTop: 2,
  },

  recordCard: {
    alignItems: "center",
    paddingVertical: 28,
  },

  micOuter: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  micOuterActive: {
    backgroundColor: "#FEE2E2",
  },

  micCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.card,
    justifyContent: "center",
    alignItems: "center",
  },

  micActive: {
    backgroundColor: "#FFF7F7",
  },

  timer: {
    fontSize: 38,
    fontWeight: "800",
    color: colors.text,
    marginTop: 20,
  },

  recordingStatus: {
    marginTop: 5,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },

  recordingStatusActive: {
    color: "#DC2626",
  },

  recordingHint: {
    marginTop: 8,
    maxWidth: 300,
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },

  durationTrack: {
    width: "100%",
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
    marginTop: 20,
  },

  durationFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  durationLabels: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },

  durationLabel: {
    fontSize: 9,
    color: colors.textFaint,
  },

  recordBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 22,
    minWidth: 190,
  },

  stopBtn: {
    backgroundColor: "#EF4444",
  },

  recordBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  loadingArea: {
    alignItems: "center",
    marginTop: 22,
    paddingHorizontal: 20,
  },

  loadingTitle: {
    marginTop: 12,
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },

  loadingText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 4,
  },

  resultCard: {
    marginTop: 4,
  },

  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  resultSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textFaint,
  },

  qualityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },

  qualityBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },

  qualityGood: {
    backgroundColor: "#DCFCE7",
  },

  qualityGoodText: {
    color: "#15803D",
  },

  qualityAcceptable: {
    backgroundColor: "#FEF3C7",
  },

  qualityAcceptableText: {
    color: "#B45309",
  },

  qualityLimited: {
    backgroundColor: "#FEE2E2",
  },

  qualityLimitedText: {
    color: "#DC2626",
  },

  scoreSection: {
    alignItems: "center",
    marginTop: 20,
  },

  scoreCircle: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
  },

  scoreValue: {
    fontSize: 48,
    fontWeight: "800",
    color: colors.primary,
  },

  scorePercent: {
    fontSize: 20,
    color: colors.primary,
    fontWeight: "700",
  },

  scoreLabel: {
    textAlign: "center",
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },

  scoreHelper: {
    maxWidth: 290,
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },

  scoreTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
    marginTop: 16,
  },

  scoreTrackFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },

  divider: {
    height: 1,
    backgroundColor: colors.surfaceMuted,
    marginVertical: 22,
  },

  featureHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },

  featureSubheading: {
    marginTop: 3,
    marginBottom: 10,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },

  featureTrack: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },

  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  featureTextArea: {
    flex: 1,
    paddingRight: 10,
  },

  featureLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },

  featureHelper: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
    color: colors.textFaint,
  },

  featureValueArea: {
    alignItems: "flex-end",
    minWidth: 58,
  },

  featureValue: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },

  featureUnit: {
    marginTop: 1,
    fontSize: 9,
    color: colors.textFaint,
  },

  interpretationBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.primarySoft,
    padding: 14,
    borderRadius: 12,
    marginTop: 18,
  },

  interpretationTitle: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 11,
  },

  interpretation: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },

  personalComparisonSection: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },

  personalComparisonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  personalComparisonIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  personalComparisonTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
  },

  personalComparisonSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  patternSummaryBox: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 13,
    borderWidth: 1,
  },

  patternSimilarBox: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },

  patternMildBox: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },

  patternDifferentBox: {
    backgroundColor: "#FFF7F7",
    borderColor: "#FECACA",
  },

  patternSummaryTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.text,
  },

  patternSummaryText: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  comparisonStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },

  comparisonStatBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },

  comparisonStatValue: {
    fontSize: 19,
    fontWeight: "800",
    color: colors.text,
  },

  comparisonStatLabel: {
    marginTop: 3,
    fontSize: 9,
    color: colors.textMuted,
  },

  comparisonFeatures: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceMuted,
    paddingHorizontal: 12,
  },

  comparisonFeaturesTitle: {
    paddingTop: 12,
    paddingBottom: 7,
    fontSize: 11,
    fontWeight: "800",
    color: colors.text,
  },

  comparisonFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },

  comparisonFeatureRowLast: {
    borderBottomWidth: 0,
  },

  comparisonFeatureName: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
  },

  comparisonFeatureDetail: {
    marginTop: 2,
    fontSize: 9,
    color: colors.textFaint,
  },

  comparisonLevelBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },

  comparisonLevelText: {
    fontSize: 9,
    fontWeight: "800",
  },

  comparisonLevelSimilar: {
    backgroundColor: "#DCFCE7",
  },

  comparisonLevelSimilarText: {
    color: "#15803D",
  },

  comparisonLevelMild: {
    backgroundColor: "#FEF3C7",
  },

  comparisonLevelMildText: {
    color: "#B45309",
  },

  comparisonLevelDifferent: {
    backgroundColor: "#FEE2E2",
  },

  comparisonLevelDifferentText: {
    color: "#B91C1C",
  },

  personalComparisonDisclaimer: {
    marginTop: 12,
    fontSize: 9,
    lineHeight: 14,
    color: colors.textMuted,
  },

  comparisonUnavailableBox: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },

  comparisonUnavailableTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.text,
  },

  comparisonUnavailableText: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  baselineRefreshText: {
    marginTop: 10,
    fontSize: 9,
    lineHeight: 14,
    color: colors.textFaint,
  },



  limitedResultBox: {
    marginTop: 20,
    alignItems: "center",
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#FFF7F7",
    borderWidth: 1,
    borderColor: "#FECACA",
  },

  limitedIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
  },

  limitedTitle: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "800",
    color: "#B91C1C",
  },

  limitedText: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    color: colors.textMuted,
  },

  retryBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: "#DC2626",
  },

  retryBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  historyCard: {
    marginTop: 4,
  },

  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  historySubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textMuted,
  },

  historyRefreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  historyLoadingArea: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 24,
  },

  historyEmptyBox: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
  },

  historyEmptyTitle: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },

  historyEmptyText: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  historyList: {
    marginTop: 14,
  },

  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },

  historyItemLast: {
    borderBottomWidth: 0,
  },

  historyScoreCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  historyScoreCircleLimited: {
    backgroundColor: "#FEE2E2",
  },

  historyScoreValue: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.primary,
  },

  historyMain: {
    flex: 1,
  },

  historyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  historyDate: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
  },

  historyQualityBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  historyQualityText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "capitalize",
  },

  historyLabel: {
    marginTop: 3,
    fontSize: 10,
    color: colors.textMuted,
  },

  historyMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 5,
    gap: 5,
  },

  historyMetric: {
    fontSize: 9,
    color: colors.textFaint,
  },

  historyMetricDot: {
    fontSize: 9,
    color: colors.textFaint,
  },
});
