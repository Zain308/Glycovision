// app/(tabs)/index.tsx

import React, { useState, useCallback, useRef } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  ActivityIndicator,
} from "react-native";

import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { Svg, Polyline, Line, Circle, Text as SvgText } from "react-native-svg";

import { router, useFocusEffect } from "expo-router";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { AnimatedPressable } from "@/components/ui/AnimatedPressable";

import {
  getDashboardSummary,
  getBgHistory,
  getCurrentIob,
  logBg,
  getSpikeIntervention,
  type BgReading,
} from "@/services/api";

import { colors, spacing, radius, type } from "@/constants/theme";

import { supabase } from "@/lib/supabase";

const SCREEN_WIDTH = Dimensions.get("window").width;

// ---------------------------------------------------------
// CHART CONSTANTS
// ---------------------------------------------------------

const CHART_HEIGHT = 220;

const CHART_PADDING_LEFT = 42;
const CHART_PADDING_RIGHT = 18;
const CHART_PADDING_TOP = 20;
const CHART_PADDING_BOTTOM = 32;

const MIN_BG = 40;
const MAX_BG = 300;

const HYPO_LIMIT = 70;
const HYPER_LIMIT = 180;

// ---------------------------------------------------------
// BG CHART
// ---------------------------------------------------------

function BgChart({ readings }: { readings: BgReading[] }) {
  const chartWidth = SCREEN_WIDTH - 76;

  const drawableWidth = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;

  const drawableHeight =
    CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  if (!readings.length) {
    return (
      <View style={styles.noChartData}>
        <Ionicons name="pulse-outline" size={30} color={colors.textFaint} />

        <Text style={styles.chartNote}>No glucose history yet</Text>

        <Text style={styles.chartSub}>
          Log a few BG readings to build your glucose trend.
        </Text>
      </View>
    );
  }

  // -------------------------------------------------------
  // X AXIS
  // -------------------------------------------------------

  const timestamps = readings.map((reading) =>
    new Date(reading.logged_at).getTime(),
  );

  const minTime = Math.min(...timestamps);

  const maxTime = Math.max(...timestamps);

  const timeRange = Math.max(maxTime - minTime, 1);

  const getX = (timestamp: number) => {
    if (readings.length === 1) {
      return CHART_PADDING_LEFT + drawableWidth / 2;
    }

    return (
      CHART_PADDING_LEFT + ((timestamp - minTime) / timeRange) * drawableWidth
    );
  };

  // -------------------------------------------------------
  // Y AXIS
  // -------------------------------------------------------

  const getY = (value: number) => {
    const bounded = Math.max(MIN_BG, Math.min(MAX_BG, value));

    const ratio = (bounded - MIN_BG) / (MAX_BG - MIN_BG);

    return CHART_PADDING_TOP + drawableHeight - ratio * drawableHeight;
  };

  const points = readings
    .map((reading) => {
      const x = getX(new Date(reading.logged_at).getTime());

      const y = getY(reading.value);

      return `${x},${y}`;
    })
    .join(" ");

  const hypoY = getY(HYPO_LIMIT);

  const hyperY = getY(HYPER_LIMIT);

  const firstReading = readings[0];

  const lastReading = readings[readings.length - 1];

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        {/* HIGH LIMIT */}

        <Line
          x1={CHART_PADDING_LEFT}
          y1={hyperY}
          x2={chartWidth - CHART_PADDING_RIGHT}
          y2={hyperY}
          stroke="#F59E0B"
          strokeWidth={1}
          strokeDasharray="5 5"
        />

        {/* LOW LIMIT */}

        <Line
          x1={CHART_PADDING_LEFT}
          y1={hypoY}
          x2={chartWidth - CHART_PADDING_RIGHT}
          y2={hypoY}
          stroke="#EF4444"
          strokeWidth={1}
          strokeDasharray="5 5"
        />

        <SvgText x={4} y={hyperY + 4} fontSize="10" fill="#F59E0B">
          180
        </SvgText>

        <SvgText x={12} y={hypoY + 4} fontSize="10" fill="#EF4444">
          70
        </SvgText>

        {/* BG LINE */}

        {readings.length > 1 && (
          <Polyline
            points={points}
            fill="none"
            stroke={colors.primary}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* DATA POINTS */}

        {readings.map((reading, index) => {
          const x = getX(new Date(reading.logged_at).getTime());

          const y = getY(reading.value);

          return (
            <Circle
              key={reading.id ?? `${reading.logged_at}-${index}`}
              cx={x}
              cy={y}
              r={4}
              fill="#FFFFFF"
              stroke={colors.primary}
              strokeWidth={2}
            />
          );
        })}

        {/* TIME LABELS */}

        <SvgText
          x={CHART_PADDING_LEFT}
          y={CHART_HEIGHT - 8}
          fontSize="10"
          fill={colors.textFaint}
        >
          {formatTime(firstReading.logged_at)}
        </SvgText>

        {readings.length > 1 && (
          <SvgText
            x={chartWidth - CHART_PADDING_RIGHT}
            y={CHART_HEIGHT - 8}
            fontSize="10"
            textAnchor="end"
            fill={colors.textFaint}
          >
            {formatTime(lastReading.logged_at)}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------

export default function DashboardScreen() {
  const [summary, setSummary] = useState<any>(null);

  const [bgHistory, setBgHistory] = useState<BgReading[]>([]);

  const [currentIob, setCurrentIob] = useState<{
    iob: number;
    dia_hours: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [bgModalVisible, setBgModalVisible] = useState(false);

  const [bgInput, setBgInput] = useState("");

  const [savingBg, setSavingBg] = useState(false);

  // A ref, not just state: two quick taps can both run before the
  // re-render that disables the button, logging the reading twice.
  const savingBgRef = useRef(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [spikeRisk, setSpikeRisk] = useState<any>(null);

  const [spikeRiskLoading, setSpikeRiskLoading] = useState(false);

  const [spikeIntervention, setSpikeIntervention] = useState<any>(null);

  const [interventionLoading, setInterventionLoading] = useState(false);

  // Prevent overlapping dashboard requests.
  const loadInFlightRef = useRef(false);

  // Avoid immediately repeating focus-triggered requests.
  const lastLoadAtRef = useRef(0);

  // -------------------------------------------------------
  // LOAD DASHBOARD
  // -------------------------------------------------------

  const load = useCallback(async (force = false) => {
    const now = Date.now();

    if (loadInFlightRef.current) {
      return;
    }

    if (!force && now - lastLoadAtRef.current < 2000) {
      return;
    }

    loadInFlightRef.current = true;

    lastLoadAtRef.current = now;

    try {
      const [dashboardData, historyData, iobData] = await Promise.all([
        getDashboardSummary(),
        getBgHistory(24),
        getCurrentIob(),
      ]);

      setSummary(dashboardData);

      setLoadError(null);

      setBgHistory(historyData.readings ?? []);

      setCurrentIob(iobData);

      // -----------------------------------------------
      // SPIKE RISK + INTERVENTION
      // -----------------------------------------------

      try {
        setSpikeRiskLoading(true);
        setInterventionLoading(true);

        const interventionData = await getSpikeIntervention();

        setSpikeIntervention(interventionData);

        // The intervention endpoint already contains
        // the underlying spike-risk result.
        const riskData = interventionData?.risk ?? null;

        setSpikeRisk(riskData);

        console.log(
          "SPIKE INTERVENTION:",
          JSON.stringify(interventionData, null, 2),
        );

        console.log(
          "SPIKE RISK FROM INTERVENTION:",
          JSON.stringify(riskData, null, 2),
        );
      } catch (error) {
        console.log("Spike prediction/intervention unavailable:", error);

        setSpikeRisk(null);
        setSpikeIntervention(null);
      } finally {
        setSpikeRiskLoading(false);
        setInterventionLoading(false);
      }
    } catch (error) {
      console.error("Failed to load dashboard", error);

      setLoadError(
        "Couldn't load your latest data. Check your internet connection and try again.",
      );
    } finally {
      loadInFlightRef.current = false;

      setLoading(false);

      setRefreshing(false);
    }
  }, []);

  // -------------------------------------------------------
  // INITIAL LOAD
  // -------------------------------------------------------

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadDashboard = async () => {
        await supabase.auth.getSession();

        if (active) {
          await load();
        }
      };

      loadDashboard();

      return () => {
        active = false;
      };
    }, [load]),
  );

  // -------------------------------------------------------
  // REFRESH
  // -------------------------------------------------------

  const onRefresh = () => {
    setRefreshing(true);

    load(true);
  };

  // -------------------------------------------------------
  // LOG BG
  // -------------------------------------------------------

  const handleLogBg = async () => {
    if (savingBgRef.current) {
      return;
    }

    const value = parseFloat(bgInput);

    if (Number.isNaN(value) || value <= 20 || value >= 600) {
      Alert.alert(
        "Invalid value",
        "Enter a blood glucose value between 20 and 600 mg/dL.",
      );

      return;
    }

    savingBgRef.current = true;
    setSavingBg(true);

    try {
      await logBg(value);

      setBgModalVisible(false);

      setBgInput("");

      await load(true);
    } catch (error) {
      console.error("BG logging failed", error);

      Alert.alert("Error", "Could not log BG reading.");
    } finally {
      savingBgRef.current = false;
      setSavingBg(false);
    }
  };

  // -------------------------------------------------------
  // TREND
  // -------------------------------------------------------

  const getTrend = () => {
    if (bgHistory.length < 2) {
      return {
        icon: "remove-outline" as const,
        label: "Not enough data",
      };
    }

    // Sort by timestamp so the calculation stays correct even if
    // the API ever returns readings in a different order.
    const sortedReadings = [...bgHistory]
      .filter((reading) => {
        const timestamp = new Date(reading.logged_at).getTime();

        return Number.isFinite(timestamp) && Number.isFinite(reading.value);
      })
      .sort(
        (a, b) =>
          new Date(a.logged_at).getTime() -
          new Date(b.logged_at).getTime(),
      );

    if (sortedReadings.length < 2) {
      return {
        icon: "remove-outline" as const,
        label: "Not enough data",
      };
    }

    const latestReading = sortedReadings[sortedReadings.length - 1];
    const latestTime = new Date(latestReading.logged_at).getTime();

    // Prefer a reading close to 15 minutes before the latest one.
    // This works better for both CGM-style data and manually logged BG
    // because it uses real timestamps instead of assuming fixed spacing.
    const TARGET_LOOKBACK_MS = 15 * 60 * 1000;
    const MAX_LOOKBACK_ERROR_MS = 10 * 60 * 1000;

    const targetTime = latestTime - TARGET_LOOKBACK_MS;

    let comparisonReading: BgReading | null = null;
    let smallestTimeDifference = Number.POSITIVE_INFINITY;

    for (let index = 0; index < sortedReadings.length - 1; index++) {
      const reading = sortedReadings[index];
      const readingTime = new Date(reading.logged_at).getTime();

      // Do not compare against readings at or after the newest sample.
      if (readingTime >= latestTime) {
        continue;
      }

      const timeDifference = Math.abs(readingTime - targetTime);

      if (timeDifference < smallestTimeDifference) {
        smallestTimeDifference = timeDifference;
        comparisonReading = reading;
      }
    }

    // If there is no reasonably close reading around the 15-minute
    // lookback point, avoid showing a potentially misleading trend.
    if (
      !comparisonReading ||
      smallestTimeDifference > MAX_LOOKBACK_ERROR_MS
    ) {
      return {
        icon: "remove-outline" as const,
        label: "Not enough recent data",
      };
    }

    const difference =
      latestReading.value - comparisonReading.value;

    if (difference >= 10) {
      return {
        icon: "trending-up-outline" as const,
        label: "Rising",
      };
    }

    if (difference <= -10) {
      return {
        icon: "trending-down-outline" as const,
        label: "Falling",
      };
    }

    return {
      icon: "remove-outline" as const,
      label: "Stable",
    };
  };

  const trend = getTrend();

  // -------------------------------------------------------
  // RISK DISPLAY HELPERS
  // -------------------------------------------------------

  const formatUpdatedTime = () => {
    const referenceTime =
      spikeRisk?.prediction_reference_time ?? spikeRisk?.latest_bg_at ?? null;

    if (!referenceTime) {
      return "No recent glucose reading";
    }

    const referenceDate = new Date(referenceTime);

    const minutes = Math.max(
      0,
      Math.floor((Date.now() - referenceDate.getTime()) / 60000),
    );

    if (minutes < 1) {
      return "Updated just now";
    }

    if (minutes === 1) {
      return "Updated 1 min ago";
    }

    if (minutes < 60) {
      return `Updated ${minutes} min ago`;
    }

    const hours = Math.floor(minutes / 60);

    return hours === 1 ? "Updated 1 hour ago" : `Updated ${hours} hours ago`;
  };

  const getPredictionSourceText = () => {
    if (spikeRisk?.prediction_mode === "dense") {
      return "Full glucose history available";
    }

    if (spikeRisk?.prediction_mode === "sparse") {
      return "Estimated from available BG checkpoints";
    }

    return "";
  };

  const getRiskExplanation = () => {
    if (spikeRisk?.risk_level === "elevated") {
      return (
        "Your recent glucose pattern shows an elevated " +
        "short-term rise risk. Keep monitoring your glucose."
      );
    }

    if (spikeRisk?.risk_level === "moderate") {
      return (
        "Your recent glucose pattern shows some short-term " +
        "rise risk. Continue monitoring your glucose trend."
      );
    }

    return (
      "Your recent glucose pattern currently shows a lower " +
      "short-term rise risk."
    );
  };

  const getNotReadyProgressText = () => {
    const sparse = spikeRisk?.sparse_model;

    if (sparse?.required_anchors != null) {
      const missing = sparse?.missing_offsets_minutes ?? [];

      const matched = Math.max(
        0,
        Number(sparse.required_anchors) - missing.length,
      );

      return (
        `${matched} / ${sparse.required_anchors} ` +
        "key BG checkpoints available"
      );
    }

    const available =
      spikeRisk?.available_readings ??
      spikeRisk?.dense_model?.available_readings ??
      0;

    const required =
      spikeRisk?.required_readings ??
      spikeRisk?.dense_model?.required_readings ??
      13;

    return `${available} / ${required} readings available`;
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingBottom: 40,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {/* HEADER */}

      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <Ionicons name="water" size={22} color={colors.primary} />
          </View>

          <View>
            <Text style={styles.appName}>
              GlycoVision <Text style={styles.aiBadge}>AI</Text>
            </Text>

            {loading ? (
              <Skeleton
                width={140}
                height={13}
                style={{
                  marginTop: 4,
                }}
              />
            ) : (
              <Text style={styles.userSub}>
                {summary?.full_name}
                {" · "}
                {summary?.diabetes_type}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* LOAD ERROR */}

      {loadError && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <TouchableOpacity onPress={onRefresh} hitSlop={8}>
            <Text style={styles.errorBannerAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* CURRENT BG + TIME IN RANGE */}

      <View style={styles.metricsRow}>
        <AnimatedPressable
          onPress={() => setBgModalVisible(true)}
          containerStyle={{ flex: 1 }}
          style={{ flex: 1 }}
        >
          <Card style={styles.metricCard}>
            <View style={styles.metricHeader}>
              <Ionicons name="water" size={18} color={colors.primary} />

              <Ionicons
                name="add-circle-outline"
                size={16}
                color={colors.textFaint}
              />
            </View>

            {loading ? (
              <Skeleton width={70} height={26} />
            ) : (
              <Text style={styles.metricValue}>
                {summary?.latest_bg ?? "—"}{" "}
                <Text style={styles.unit}>mg/dL</Text>
              </Text>
            )}

            <Text style={styles.metricLabel}>Current BG</Text>
          </Card>
        </AnimatedPressable>

        <Card style={styles.metricCard}>
          <MaterialCommunityIcons
            name="target"
            size={18}
            color={colors.success}
          />

          {loading ? (
            <Skeleton width={70} height={26} />
          ) : (
            <Text style={styles.metricValue}>
              {summary?.time_in_range_pct != null
                ? `${summary.time_in_range_pct}%`
                : "—"}
            </Text>
          )}

          <Text style={styles.metricLabel}>Time in Range</Text>
        </Card>
      </View>

      {/* CARBS + RESEARCH BOLUS */}

      <View style={styles.metricsRow}>
        <Card style={styles.metricCard}>
          <MaterialCommunityIcons
            name="bread-slice"
            size={18}
            color={colors.warning}
          />

          <Text style={styles.metricValue}>
            {summary?.total_carbs_today ?? 0}g
          </Text>

          <Text style={styles.metricLabel}>Total Carbs</Text>
        </Card>

        <Card style={styles.metricCard}>
          <MaterialCommunityIcons name="needle" size={18} color="#8B5CF6" />

          <Text style={styles.metricValue}>
            {summary?.total_insulin_today ?? 0}
          </Text>

          <Text style={styles.metricLabel}>Research Bolus</Text>
        </Card>
      </View>

      {/* ESTIMATED ACTIVE IOB */}

      <Card style={styles.iobCard}>
        <View style={styles.iobHeader}>
          <View style={styles.iobIconBox}>
            <MaterialCommunityIcons name="needle" size={20} color={colors.primary} />
          </View>

          <View style={styles.iobHeaderText}>
            <Text style={styles.iobTitle}>Estimated Active IOB</Text>
            <Text style={styles.iobSubtitle}>
              Estimated active insulin modeled from logged research bolus entries
            </Text>
          </View>
        </View>

        {loading ? (
          <Skeleton width={110} height={30} />
        ) : (
          <View style={styles.iobValueRow}>
            <Text style={styles.iobValue}>
              {currentIob?.iob != null ? Number(currentIob.iob).toFixed(1) : "—"}
              <Text style={styles.iobUnit}> U</Text>
            </Text>

            <View style={styles.diaBadge}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={styles.diaText}>
                DIA: {currentIob?.dia_hours ?? "—"} h
              </Text>
            </View>
          </View>
        )}

        <View style={styles.iobNotice}>
          <Ionicons
            name="information-circle-outline"
            size={15}
            color={colors.textMuted}
          />
          <Text style={styles.iobNoticeText}>
            Research estimate modeled from logged research bolus entries and configured
            insulin duration. A logged estimate does not confirm insulin was
            administered, and this value must not be used to determine dosing.
          </Text>
        </View>
      </Card>

      {/* GLUCOSE CHART */}

      <Card>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.sectionTitle}>Glucose Trend</Text>

            <Text style={styles.chartWindowText}>Last 24 hours</Text>
          </View>

          <AnimatedPressable onPress={() => setBgModalVisible(true)}>
            <View style={styles.liveBadge}>
              <Ionicons name="add" size={14} color={colors.success} />

              <Text style={styles.liveText}>LOG BG</Text>
            </View>
          </AnimatedPressable>
        </View>

        {loading ? (
          <Skeleton width="90%" height={160} />
        ) : (
          <BgChart readings={bgHistory} />
        )}

        {bgHistory.length > 0 && (
          <View style={styles.trendRow}>
            <Ionicons name={trend.icon} size={18} color={colors.primary} />

            <Text style={styles.trendText}>{trend.label}</Text>

            <Text style={styles.readingCount}>{bgHistory.length} {bgHistory.length === 1 ? "reading" : "readings"}</Text>
          </View>
        )}
      </Card>

      {/* 60-MINUTE GLUCOSE RISK */}

      <Card>
        <View style={styles.riskHeader}>
          <View>
            <Text style={styles.sectionTitle}>60-Minute Glucose Risk</Text>

            <Text style={styles.riskSubtitle}>
              AI-assisted short-term glucose trend estimate
            </Text>
          </View>

          <Ionicons name="analytics-outline" size={24} color={colors.primary} />
        </View>

        {spikeRiskLoading ? (
          <View style={styles.riskLoading}>
            <ActivityIndicator color={colors.primary} />

            <Text style={styles.riskLoadingText}>
              Analyzing recent glucose history...
            </Text>
          </View>
        ) : spikeRisk?.status === "stale" ? (
          <View style={styles.staleBox}>
            <Ionicons
              name="alert-circle-outline"
              size={30}
              color={colors.warning}
            />

            <Text style={styles.staleTitle}>Glucose data is stale</Text>

            <Text style={styles.staleText}>
              {spikeRisk.message ??
                "Your latest glucose reading is too old for a current 60-minute glucose-rise risk estimate."}
            </Text>

            {spikeRisk.age_minutes != null && (
              <Text style={styles.staleMeta}>
                Latest BG is about {Math.round(spikeRisk.age_minutes)} min old
              </Text>
            )}

            <TouchableOpacity
              style={styles.staleButton}
              onPress={() => setBgModalVisible(true)}
            >
              <Ionicons name="add-circle-outline" size={17} color="#fff" />

              <Text style={styles.staleButtonText}>Log New BG</Text>
            </TouchableOpacity>
          </View>
        ) : spikeRisk?.status === "ready" ? (
          <>
            <View style={styles.riskScoreRow}>
              <View>
                <Text style={styles.riskScore}>{spikeRisk.risk_percent}%</Text>

                <Text style={styles.riskScoreLabel}>
                  60-minute glucose-rise risk score
                </Text>
              </View>

              <View
                style={[
                  styles.riskBadge,

                  spikeRisk.risk_level === "low" && styles.riskLow,

                  spikeRisk.risk_level === "moderate" && styles.riskModerate,

                  spikeRisk.risk_level === "elevated" && styles.riskElevated,
                ]}
              >
                <Text
                  style={[
                    styles.riskBadgeText,

                    spikeRisk.risk_level === "low" && styles.riskLowText,

                    spikeRisk.risk_level === "moderate" &&
                      styles.riskModerateText,

                    spikeRisk.risk_level === "elevated" &&
                      styles.riskElevatedText,
                  ]}
                >
                  {String(spikeRisk.risk_level).toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.riskSourceRow}>
              <Ionicons
                name={
                  spikeRisk.prediction_mode === "dense"
                    ? "checkmark-circle-outline"
                    : "layers-outline"
                }
                size={15}
                color={colors.primary}
              />

              <Text style={styles.riskSourceText}>
                {getPredictionSourceText()}
              </Text>
            </View>

            <Text style={styles.riskExplanation}>{getRiskExplanation()}</Text>

            <View style={styles.riskStats}>
              <View style={styles.riskStatItem}>
                <Text style={styles.riskStatValue}>{spikeRisk.current_bg}</Text>

                <Text style={styles.riskStatLabel}>Current BG</Text>
              </View>

              <View style={styles.riskStatItem}>
                <Text style={styles.riskStatValue}>
                  {spikeRisk.bg_change_15m > 0 ? "+" : ""}
                  {spikeRisk.bg_change_15m}
                </Text>

                <Text style={styles.riskStatLabel}>15m change</Text>
              </View>

              <View style={styles.riskStatItem}>
                <Text style={styles.riskStatValue}>
                  {spikeRisk.bg_change_30m > 0 ? "+" : ""}
                  {spikeRisk.bg_change_30m}
                </Text>

                <Text style={styles.riskStatLabel}>30m change</Text>
              </View>
            </View>

            <View style={styles.riskContextRow}>
              <Text style={styles.riskContext}>
                Carbs last 60m: {spikeRisk.carbs_60m}g
              </Text>

              <Text style={styles.riskContext}>
                Bolus last 60m: {spikeRisk.bolus_60m}u
              </Text>
            </View>

            <View style={styles.riskUpdatedRow}>
              <Ionicons
                name="time-outline"
                size={14}
                color={colors.textFaint}
              />

              <Text style={styles.riskUpdatedText}>{formatUpdatedTime()}</Text>
            </View>

            <View style={styles.researchNotice}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={colors.textMuted}
              />

              <Text style={styles.researchNoticeText}>
                Research prediction only. Do not use this score as an
                insulin-dosing instruction.
              </Text>
            </View>
          </>
        ) : spikeRisk?.status === "not_ready" ? (
          <View style={styles.notReadyBox}>
            <Ionicons
              name="hourglass-outline"
              size={30}
              color={colors.primary}
            />

            <Text style={styles.notReadyTitle}>Building glucose history</Text>

            <Text style={styles.notReadyCount}>
              {getNotReadyProgressText()}
            </Text>

            <Text style={styles.notReadyText}>
              {spikeRisk.message ??
                "More glucose history is needed before GlycoVision can estimate your 60-minute glucose-rise risk."}
            </Text>

            <TouchableOpacity
              style={styles.notReadyButton}
              onPress={() => setBgModalVisible(true)}
            >
              <Ionicons
                name="add-circle-outline"
                size={17}
                color={colors.primary}
              />

              <Text style={styles.notReadyButtonText}>Log BG</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.notReadyBox}>
            <Ionicons
              name="analytics-outline"
              size={28}
              color={colors.textFaint}
            />

            <Text style={styles.notReadyText}>
              Spike-risk information is currently unavailable.
            </Text>
          </View>
        )}
      </Card>

      {/* RECOMMENDED NEXT STEP */}

      <Card>
        <View style={styles.interventionHeader}>
          <View
            style={{
              flex: 1,
              paddingRight: 12,
            }}
          >
            <Text style={styles.sectionTitle}>Recommended Next Step</Text>

            <Text style={styles.interventionSubtitle}>
              Context-aware guidance from your recent glucose data
            </Text>
          </View>

          <Ionicons
            name="navigate-circle-outline"
            size={26}
            color={colors.primary}
          />
        </View>

        {interventionLoading ? (
          <View style={styles.interventionLoading}>
            <ActivityIndicator color={colors.primary} />

            <Text style={styles.interventionLoadingText}>
              Preparing guidance...
            </Text>
          </View>
        ) : spikeIntervention ? (
          <>
            <View style={styles.interventionTitleRow}>
              <View
                style={[
                  styles.interventionIconBox,

                  spikeIntervention.severity === "low" &&
                    styles.interventionLow,

                  spikeIntervention.severity === "moderate" &&
                    styles.interventionModerate,

                  spikeIntervention.severity === "elevated" &&
                    styles.interventionElevated,

                  spikeIntervention.severity === "info" &&
                    styles.interventionInfo,
                ]}
              >
                <Ionicons
                  name={
                    spikeIntervention.severity === "elevated"
                      ? "warning-outline"
                      : spikeIntervention.severity === "moderate"
                        ? "eye-outline"
                        : spikeIntervention.severity === "low"
                          ? "checkmark-circle-outline"
                          : "information-circle-outline"
                  }
                  size={20}
                  color={
                    spikeIntervention.severity === "elevated"
                      ? "#DC2626"
                      : spikeIntervention.severity === "moderate"
                        ? "#B45309"
                        : spikeIntervention.severity === "low"
                          ? "#15803D"
                          : colors.primary
                  }
                />
              </View>

              <Text style={styles.interventionTitle}>
                {spikeIntervention.title}
              </Text>
            </View>

            <Text style={styles.interventionMessage}>
              {spikeIntervention.message}
            </Text>

            <View style={styles.nextStepBox}>
              <Ionicons
                name="arrow-forward-circle-outline"
                size={18}
                color={colors.primary}
              />

              <Text style={styles.nextStepText}>
                {spikeIntervention.recommended_next_step}
              </Text>
            </View>

            {spikeIntervention.trend && (
              <View style={styles.interventionMetaRow}>
                <Text style={styles.interventionMeta}>
                  Trend: {String(spikeIntervention.trend).toUpperCase()}
                </Text>

                {spikeIntervention.risk_percent != null && (
                  <Text style={styles.interventionMeta}>
                    Risk: {spikeIntervention.risk_percent}%
                  </Text>
                )}
              </View>
            )}

            {(spikeIntervention.status === "stale" ||
              spikeIntervention.status === "not_ready") && (
              <TouchableOpacity
                style={styles.interventionActionButton}
                onPress={() => setBgModalVisible(true)}
              >
                <Ionicons name="add-circle-outline" size={17} color="#fff" />

                <Text style={styles.interventionActionButtonText}>
                  Log New BG
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.interventionDisclaimer}>
              <Ionicons
                name="shield-checkmark-outline"
                size={15}
                color={colors.textMuted}
              />

              <Text style={styles.interventionDisclaimerText}>
                {spikeIntervention.disclaimer ??
                  "Research decision-support only. Do not use this guidance for insulin dosing."}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.interventionEmpty}>
            <Ionicons
              name="information-circle-outline"
              size={26}
              color={colors.textFaint}
            />

            <Text style={styles.interventionLoadingText}>
              Guidance is currently unavailable.
            </Text>
          </View>
        )}
      </Card>

      {/* NUTRITION */}

      <Card>
        <Text style={styles.sectionTitle}>Today's Nutrition</Text>

        {summary?.meals_logged_today > 0 ? (
          <Text style={styles.emptyText}>
            {summary.meals_logged_today} meal(s) logged today
          </Text>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons
              name="restaurant-outline"
              size={42}
              color={colors.textFaint}
            />

            <Text style={styles.emptyTitle}>Nothing logged yet</Text>

            <Text style={styles.emptySub}>
              Scan your next meal and it'll show up here.
            </Text>

            <AnimatedPressable
              style={styles.primaryBtn}
              onPress={() => router.push("/(tabs)/scanner")}
            >
              <Ionicons name="camera" size={18} color="#fff" />

              <Text style={styles.primaryBtnText}>Scan a meal</Text>
            </AnimatedPressable>
          </View>
        )}
      </Card>

      {/* BG MODAL */}

      <Modal visible={bgModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Log Blood Glucose</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 140"
              keyboardType="decimal-pad"
              value={bgInput}
              onChangeText={setBgInput}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setBgModalVisible(false);

                  setBgInput("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <AnimatedPressable
                style={[styles.modalSaveBtn, savingBg && { opacity: 0.6 }]}
                onPress={handleLogBg}
                disabled={savingBg}
              >
                <Text style={styles.modalSaveText}>
                  {savingBg ? "Saving..." : "Save"}
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------

const styles = StyleSheet.create({
  staleMeta: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 8,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: 50,
    paddingBottom: spacing.md,
  },

  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },

  logoCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },

  appName: {
    ...type.sectionTitle,
    fontSize: 20,
  },

  aiBadge: {
    color: colors.primary,
  },

  userSub: {
    fontSize: 13,
    color: colors.textMuted,
  },

  metricsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: 4,
  },

  metricCard: {
    flex: 1,
    padding: spacing.lg,
  },

  metricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  metricValue: {
    ...type.metricValue,
    marginTop: 6,
  },

  unit: {
    fontSize: 12,
    color: colors.textMuted,
  },

  metricLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },

  iobCard: {
    marginTop: 4,
  },

  iobHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  iobIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },

  iobHeaderText: {
    flex: 1,
  },

  iobTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },

  iobSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 2,
  },

  iobValueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },

  iobValue: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.text,
  },

  iobUnit: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textMuted,
  },

  diaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },

  diaText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },

  iobNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 14,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },

  iobNoticeText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  sectionTitle: {
    ...type.sectionTitle,
  },

  chartWindowText: {
    fontSize: 11,
    color: colors.textFaint,
  },

  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },

  liveText: {
    fontSize: 11,
    color: colors.success,
    fontWeight: "600",
  },

  chartContainer: {
    alignItems: "center",
  },

  noChartData: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },

  chartNote: {
    marginTop: 8,
    color: colors.textMuted,
  },

  chartSub: {
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 4,
    textAlign: "center",
  },

  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },

  trendText: {
    fontWeight: "600",
    color: colors.text,
  },

  readingCount: {
    marginLeft: "auto",
    color: colors.textFaint,
    fontSize: 11,
  },

  riskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },

  riskSubtitle: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 3,
  },

  riskLoading: {
    paddingVertical: 30,
    alignItems: "center",
    gap: 10,
  },

  riskLoadingText: {
    fontSize: 12,
    color: colors.textMuted,
  },

  riskScoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  riskScore: {
    fontSize: 38,
    fontWeight: "800",
    color: colors.text,
  },

  riskScoreLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  riskBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },

  riskBadgeText: {
    fontSize: 12,
    fontWeight: "800",
  },

  riskLow: {
    backgroundColor: "#DCFCE7",
  },

  riskLowText: {
    color: "#15803D",
  },

  riskModerate: {
    backgroundColor: "#FEF3C7",
  },

  riskModerateText: {
    color: "#B45309",
  },

  riskElevated: {
    backgroundColor: "#FEE2E2",
  },

  riskElevatedText: {
    color: "#DC2626",
  },

  riskSourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },

  riskSourceText: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: "600",
  },

  riskExplanation: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: 12,
  },

  riskStats: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },

  riskStatItem: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: "center",
  },

  riskStatValue: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },

  riskStatLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 3,
  },

  riskContextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    gap: 10,
  },

  riskContext: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
  },

  researchNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 18,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
  },

  researchNoticeText: {
    flex: 1,
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 15,
  },

  notReadyBox: {
    paddingVertical: 24,
    alignItems: "center",
  },

  notReadyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginTop: 8,
  },

  notReadyCount: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.primary,
    marginTop: 8,
  },

  notReadyText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 6,
    maxWidth: 300,
  },

  notReadyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },

  notReadyButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },

  riskUpdatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 12,
  },

  riskUpdatedText: {
    fontSize: 10,
    color: colors.textFaint,
  },

  staleBox: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 10,
  },

  staleTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginTop: 8,
  },

  staleText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 6,
    maxWidth: 290,
  },

  staleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.pill,
    marginTop: 14,
  },

  staleButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  interventionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  interventionSubtitle: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 3,
  },

  interventionLoading: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 10,
  },

  interventionLoadingText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },

  interventionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  interventionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },

  interventionLow: {
    backgroundColor: "#DCFCE7",
  },

  interventionModerate: {
    backgroundColor: "#FEF3C7",
  },

  interventionElevated: {
    backgroundColor: "#FEE2E2",
  },

  interventionInfo: {
    backgroundColor: colors.primarySoft,
  },

  interventionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },

  interventionMessage: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: 12,
  },

  nextStepBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },

  nextStepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: colors.text,
  },

  interventionMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    gap: 10,
  },

  interventionMeta: {
    fontSize: 10,
    color: colors.textFaint,
  },

  interventionActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: radius.pill,
    marginTop: 14,
  },

  interventionActionButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  interventionDisclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },

  interventionDisclaimerText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
  },

  interventionEmpty: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 8,
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },

  emptyTitle: {
    fontWeight: "700",
    marginTop: 8,
  },

  emptySub: {
    color: colors.textFaint,
    marginTop: 4,
    marginBottom: 14,
    textAlign: "center",
  },

  emptyText: {
    color: colors.textMuted,
    marginTop: 8,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.pill,
  },

  primaryBtnText: {
    color: "#fff",
    fontWeight: "600",
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    padding: 20,
  },

  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 14,
  },

  modalInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: 14,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 18,
  },

  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
  },

  modalCancelBtn: {
    flex: 1,
    alignItems: "center",
    padding: 14,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
  },

  modalCancelText: {
    color: colors.textMuted,
  },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },

  errorBannerText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.text,
  },

  errorBannerAction: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.danger,
  },

  modalSaveBtn: {
    flex: 1,
    alignItems: "center",
    padding: 14,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },

  modalSaveText: {
    color: "#fff",
    fontWeight: "700",
  },
});
