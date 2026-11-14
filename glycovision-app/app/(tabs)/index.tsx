// app/(tabs)/index.tsx
//
// Home. A calm, premium overview: the latest blood sugar on a ring gauge
// (with its status in words and the trend), big quick actions, today's
// numbers that count up, a smooth 24-hour chart that draws itself in, a
// real timeline of today's meals, insulin and readings, then guidance.
// Data loading and safety logic are unchanged; only presentation is new.

import React, { useState, useCallback, useRef, useEffect } from "react";

import {
  View,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  LayoutChangeEvent,
} from "react-native";
import { Text } from "@/components/ui/Typography";

import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ResearchNote } from "@/components/ui/ResearchNote";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { AnimatedNumber, Reveal } from "@/components/ui/Motion";
import { LogoMark } from "@/components/ui/Logo";
import {
  IconBadge,
  SectionHeader,
  StatusPill,
  toneColors,
  type Tone,
} from "@/components/ui/Bits";
import { StressContextCard } from "@/components/StressContextCard";
import { LogBgSheet } from "@/components/LogBgSheet";
import { NotificationBell } from "@/components/NotificationBell";
import { GlucoseRing } from "@/components/GlucoseRing";
import { GlucoseChart, CHART_HEIGHT } from "@/components/GlucoseChart";

import {
  getDashboardSummary,
  getBgHistory,
  getCurrentIob,
  logBg,
  getSpikeIntervention,
  getStressContext,
  getTimelineToday,
  type StressContext,
  type BgReading,
  type TimelineEvent,
} from "@/services/api";

import { colors, radius, shadow, tabular } from "@/constants/theme";
import { glucoseStatus, greeting, timeAgo, RANGE_HIGH, RANGE_LOW } from "@/lib/glucose";
import { haptic } from "@/lib/haptics";
import { onBloodSugarLogged, onSpikeRisk } from "@/lib/notifications";

import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------
// SMALL PIECES
// ---------------------------------------------------------

function QuickAction({
  label,
  tone,
  onPress,
  renderIcon,
}: {
  label: string;
  tone: Tone;
  onPress: () => void;
  renderIcon: (color: string, size: number) => React.ReactNode;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
    >
      <IconBadge tone={tone} size={50} renderIcon={renderIcon} />
      <Text style={styles.quickLabel} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

function TodayStat({
  label,
  value,
  unit,
  decimals = 0,
  tone,
  renderIcon,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  tone: Tone;
  renderIcon: (color: string, size: number) => React.ReactNode;
}) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value ?? "no data"} ${unit}`}>
      <IconBadge tone={tone} size={34} renderIcon={renderIcon} />
      <View style={styles.statValueRow}>
        <AnimatedNumber value={value} decimals={decimals} style={styles.statValue} />
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const EVENT_STYLE: Record<TimelineEvent["type"], { tone: Tone; icon: (c: string, s: number) => React.ReactNode }> = {
  meal: { tone: "warning", icon: (c, s) => <Ionicons name="restaurant" size={s} color={c} /> },
  insulin: { tone: "brand", icon: (c, s) => <MaterialCommunityIcons name="needle" size={s} color={c} /> },
  bg: { tone: "success", icon: (c, s) => <Ionicons name="water" size={s} color={c} /> },
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <View>
      {events.map((e, i) => {
        const s = EVENT_STYLE[e.type];
        const tone = e.type === "bg" ? (glucoseStatus(e.value ?? null)?.tone ?? "success") : s.tone;
        const time = new Date(e.logged_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const last = i === events.length - 1;
        return (
          <View key={`${e.type}-${e.logged_at}-${i}`} style={styles.tlRow}>
            <Text style={styles.tlTime}>{time}</Text>
            <View style={styles.tlRail}>
              <View style={[styles.tlDot, { backgroundColor: toneColors[tone].strong }]} />
              {!last ? <View style={styles.tlLine} /> : null}
            </View>
            <View style={[styles.tlCard, last && { marginBottom: 0 }]}>
              <IconBadge renderIcon={s.icon} tone={tone} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tlTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.tlDetail} numberOfLines={1}>
                  {e.detail}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const riskTone = (level?: string): Tone =>
  level === "elevated" ? "danger" : level === "moderate" ? "warning" : "success";

const severityTone = (s?: string): Tone =>
  s === "elevated" ? "danger" : s === "moderate" ? "warning" : s === "low" ? "success" : "brand";

const severityIcon = (s?: string) =>
  s === "elevated"
    ? ("warning" as const)
    : s === "moderate"
      ? ("eye" as const)
      : s === "low"
        ? ("checkmark-circle" as const)
        : ("information-circle" as const);

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

  const [stressContext, setStressContext] = useState<StressContext | null>(null);

  // Today's meals, insulin and readings for the timeline.
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);

  // Other screens (e.g. Voice) open the "Log blood sugar" popup by
  // navigating here with ?logBg=1.
  const { logBg: openLogBg } = useLocalSearchParams<{ logBg?: string }>();

  useEffect(() => {
    if (openLogBg === "1") {
      setBgModalVisible(true);
      router.setParams({ logBg: undefined });
    }
  }, [openLogBg]);

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

      // Timeline loads alongside; a failure only hides that section.
      getTimelineToday()
        .then(setTimeline)
        .catch((error) => {
          console.log("Timeline unavailable:", error);
          setTimeline([]);
        });

      // -----------------------------------------------
      // SPIKE RISK + INTERVENTION
      // -----------------------------------------------

      try {
        setSpikeRiskLoading(true);
        setInterventionLoading(true);

        const [interventionData, stressData] = await Promise.all([
          getSpikeIntervention(),
          getStressContext().catch((error) => {
            console.log("Stress context unavailable:", error);
            return null;
          }),
        ]);

        setStressContext(stressData);

        setSpikeIntervention(interventionData);

        // The intervention endpoint already contains
        // the underlying spike-risk result.
        const riskData = interventionData?.risk ?? null;

        setSpikeRisk(riskData);

        // Real-time alert if a rise looks likely (rate-limited in the helper).
        onSpikeRisk(riskData?.risk_level, riskData?.risk_percent);

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

  const [chartWidth, setChartWidth] = useState(0);
  const onChartLayout = (e: LayoutChangeEvent) =>
    setChartWidth(Math.floor(e.nativeEvent.layout.width));

  const latestReading = bgHistory.length
    ? [...bgHistory].sort(
        (a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
      )[0]
    : null;
  const latestBg: number | null = summary?.latest_bg ?? latestReading?.value ?? null;
  const status = glucoseStatus(latestBg);
  const readingAge = timeAgo(latestReading?.logged_at);
  const firstName = String(summary?.full_name ?? "").split(" ")[0];
  const initials =
    String(summary?.full_name ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase())
      .join("") || "G";
  const showTrend = bgHistory.length > 1 && !trend.label.startsWith("Not enough");
  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <Screen
      top={
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <LogoMark size={32} />
            <Text style={styles.brandText}>GlycoVision</Text>
          </View>
          <View style={styles.topActions}>
            <NotificationBell />
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              accessibilityRole="button"
              accessibilityLabel="Open your profile"
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </Pressable>
          </View>
        </View>
      }
      eyebrow={today}
      title={loading ? " " : `${greeting()}${firstName ? `, ${firstName}` : ""}`}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* LOAD ERROR */}
      {loadError && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline" size={20} color={colors.dangerText} />
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <Pressable onPress={onRefresh} hitSlop={10} accessibilityRole="button">
            <Text style={styles.errorBannerAction}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* LOW SUGAR: help first */}
      {status && (status.key === "low" || status.key === "very_low") ? (
        <Pressable
          onPress={() => router.push("/low-help")}
          accessibilityRole="button"
          accessibilityLabel="Low sugar. Open low sugar help"
          style={({ pressed }) => [styles.lowBanner, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.lowIcon}>
            <Ionicons name="warning" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lowTitle}>Low sugar: act now</Text>
            <Text style={styles.lowBody}>Take 15 g of fast sugar. Tap for steps and a timer.</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.dangerText} />
        </Pressable>
      ) : null}

      {/* HERO: CURRENT BLOOD SUGAR */}
      <Reveal index={0}>
        <Card variant="hero" style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.overline}>BLOOD SUGAR</Text>
            {readingAge ? (
              <View style={styles.agePill}>
                <View style={styles.liveDot} />
                <Text style={styles.ageText}>{readingAge}</Text>
              </View>
            ) : null}
          </View>

          <View
            style={styles.ringWrap}
            accessible
            accessibilityLabel={
              latestBg != null
                ? `Blood sugar ${latestBg} milligrams per decilitre, ${status?.label ?? ""}${showTrend ? `, ${trend.label}` : ""}`
                : "No blood sugar reading yet"
            }
          >
            {loading ? <Skeleton width={190} height={190} radius={95} /> : <GlucoseRing value={latestBg} />}
          </View>

          <View style={styles.heroChips}>
            {status ? <StatusPill tone={status.tone} icon={status.icon} label={status.label} /> : null}
            {showTrend ? (
              <View style={styles.trendChip}>
                <Ionicons name={trend.icon} size={16} color={colors.primary} />
                <Text style={styles.trendChipText}>{trend.label}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.heroAdvice}>
            {status?.advice ?? "Log your first reading to see your status here."}
          </Text>

          <Button
            label="Log blood sugar"
            icon="add-circle"
            variant="onHero"
            onPress={() => setBgModalVisible(true)}
            style={{ marginTop: 16 }}
          />
        </Card>
      </Reveal>

      {/* QUICK ACTIONS */}
      <Reveal index={1}>
        <View style={styles.quickRow}>
          <QuickAction
            label="Scan meal"
            tone="brand"
            onPress={() => router.push("/(tabs)/scanner")}
            renderIcon={(c, s) => <Ionicons name="scan" size={s} color={c} />}
          />
          <QuickAction
            label="Log sugar"
            tone="success"
            onPress={() => setBgModalVisible(true)}
            renderIcon={(c, s) => <Ionicons name="water" size={s} color={c} />}
          />
          <QuickAction
            label="Bolus"
            tone="info"
            onPress={() => router.push("/(tabs)/bolus")}
            renderIcon={(c, s) => <MaterialCommunityIcons name="needle" size={s} color={c} />}
          />
          <QuickAction
            label="Voice"
            tone="warning"
            onPress={() => router.push("/(tabs)/voice")}
            renderIcon={(c, s) => <Ionicons name="mic" size={s} color={c} />}
          />
        </View>
      </Reveal>

      {/* TODAY */}
      <Reveal index={2}>
        <SectionHeader title="Today" />
        <Card style={styles.statsCard}>
          <TodayStat
            label="In range"
            value={summary?.time_in_range_pct ?? null}
            unit="%"
            tone="success"
            renderIcon={(c, s) => <MaterialCommunityIcons name="target" size={s} color={c} />}
          />
          <View style={styles.statDivider} />
          <TodayStat
            label="Carbs"
            value={summary ? Number(summary.total_carbs_today ?? 0) : null}
            unit="g"
            tone="warning"
            renderIcon={(c, s) => <MaterialCommunityIcons name="bread-slice-outline" size={s} color={c} />}
          />
          <View style={styles.statDivider} />
          <TodayStat
            label="Insulin"
            value={summary ? Number(summary.total_insulin_today ?? 0) : null}
            unit="u"
            decimals={1}
            tone="brand"
            renderIcon={(c, s) => <MaterialCommunityIcons name="needle" size={s} color={c} />}
          />
        </Card>
      </Reveal>

      {/* GLUCOSE CHART */}
      <Reveal index={3}>
        <SectionHeader title="Last 24 hours" action="Log reading" onAction={() => setBgModalVisible(true)} />
        <Card>
          <View onLayout={onChartLayout}>
            {loading ? (
              <Skeleton width="100%" height={CHART_HEIGHT} />
            ) : (
              <GlucoseChart readings={bgHistory} width={chartWidth} />
            )}
          </View>
          {bgHistory.length > 0 && (
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: colors.successSoft, borderColor: colors.success }]} />
                <Text style={styles.legendText}>
                  Target {RANGE_LOW}–{RANGE_HIGH}
                </Text>
              </View>
              <Text style={styles.legendText}>
                {bgHistory.length} {bgHistory.length === 1 ? "reading" : "readings"}
              </Text>
            </View>
          )}
        </Card>
      </Reveal>

      {/* TIMELINE */}
      <Reveal index={4}>
        <SectionHeader title="Your day" action="Scan meal" onAction={() => router.push("/(tabs)/scanner")} />
        <Card>
          {timeline == null ? (
            <View style={{ gap: 12 }}>
              <Skeleton width="100%" height={52} />
              <Skeleton width="100%" height={52} />
            </View>
          ) : timeline.length ? (
            <Timeline events={timeline.slice(0, 6)} />
          ) : (
            <View style={styles.emptyState}>
              <IconBadge icon="sunny" tone="warning" size={56} />
              <Text style={styles.emptyTitle}>A fresh start</Text>
              <Text style={styles.emptySub}>
                Your meals, insulin and readings will appear here as you log them today.
              </Text>
              <Button
                label="Scan your first meal"
                icon="scan"
                onPress={() => router.push("/(tabs)/scanner")}
                containerStyle={{ alignSelf: "stretch" }}
              />
            </View>
          )}
        </Card>
      </Reveal>

      {/* RECOMMENDED NEXT STEP */}
      <Reveal index={5}>
        <SectionHeader title="What to do next" />
        <Card>
          {interventionLoading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Preparing guidance…</Text>
            </View>
          ) : spikeIntervention ? (
            <>
              <View style={styles.cardHead}>
                <IconBadge icon={severityIcon(spikeIntervention.severity)} tone={severityTone(spikeIntervention.severity)} />
                <Text style={styles.cardHeadTitle}>{spikeIntervention.title}</Text>
              </View>
              <Text style={styles.bodyText}>{spikeIntervention.message}</Text>

              {spikeIntervention.recommended_next_step ? (
                <View style={styles.nextStepBox}>
                  <Ionicons name="arrow-forward-circle" size={22} color={colors.primary} />
                  <Text style={styles.nextStepText}>{spikeIntervention.recommended_next_step}</Text>
                </View>
              ) : null}

              {spikeIntervention.stress_note ? (
                <View style={styles.stressNoteBox}>
                  <Ionicons name="pulse" size={18} color={colors.warningText} />
                  <Text style={styles.stressNoteText}>{spikeIntervention.stress_note}</Text>
                </View>
              ) : null}

              {(spikeIntervention.status === "stale" || spikeIntervention.status === "not_ready") && (
                <Button label="Log new reading" icon="add-circle" size="md" onPress={() => setBgModalVisible(true)} style={{ marginTop: 14 }} />
              )}

              <ResearchNote
                label="Decision support · not for dosing"
                details={
                  spikeIntervention.disclaimer ??
                  "Research decision-support only. Do not use this guidance for insulin dosing."
                }
              />
            </>
          ) : (
            <View style={styles.centerRow}>
              <Ionicons name="information-circle-outline" size={22} color={colors.textFaint} />
              <Text style={styles.muted}>Guidance is not available right now.</Text>
            </View>
          )}
        </Card>
      </Reveal>

      {/* 60-MINUTE RISK */}
      <Reveal index={6}>
        <Card>
          <View style={styles.cardHead}>
            <IconBadge icon="analytics" tone="brand" />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardHeadTitle}>Next 60 minutes</Text>
              <Text style={styles.cardHeadSub}>Chance your sugar rises soon</Text>
            </View>
          </View>

          {spikeRiskLoading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Checking your recent readings…</Text>
            </View>
          ) : spikeRisk?.status === "ready" ? (
            <>
              <View style={styles.riskRow}>
                <AnimatedNumber value={Number(spikeRisk.risk_percent)} style={styles.riskScore} />
                <Text style={styles.riskPct}>%</Text>
                <View style={{ flex: 1 }} />
                <StatusPill
                  tone={riskTone(spikeRisk.risk_level)}
                  icon={spikeRisk.risk_level === "low" ? "checkmark-circle" : "warning"}
                  label={
                    spikeRisk.risk_level === "elevated"
                      ? "Higher risk"
                      : spikeRisk.risk_level === "moderate"
                        ? "Some risk"
                        : "Low risk"
                  }
                />
              </View>

              <View style={styles.meter} accessibilityElementsHidden>
                {(["low", "moderate", "elevated"] as const).map((lvl) => (
                  <View
                    key={lvl}
                    style={[
                      styles.meterSeg,
                      {
                        backgroundColor:
                          lvl === spikeRisk.risk_level ? toneColors[riskTone(lvl)].strong : colors.surfaceMuted,
                      },
                    ]}
                  />
                ))}
              </View>

              <Text style={styles.bodyText}>{getRiskExplanation()}</Text>

              <View style={styles.statsRow}>
                {[
                  { v: `${spikeRisk.current_bg}`, l: "Now" },
                  { v: `${spikeRisk.bg_change_15m > 0 ? "+" : ""}${spikeRisk.bg_change_15m}`, l: "15 min" },
                  { v: `${spikeRisk.bg_change_30m > 0 ? "+" : ""}${spikeRisk.bg_change_30m}`, l: "30 min" },
                ].map((s) => (
                  <View key={s.l} style={styles.statBox}>
                    <Text style={styles.statBoxValue}>{s.v}</Text>
                    <Text style={styles.statBoxLabel}>{s.l}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.metaText}>
                Last hour: {spikeRisk.carbs_60m} g carbs · {spikeRisk.bolus_60m} u insulin
              </Text>
              <Text style={styles.metaText}>
                {formatUpdatedTime()}
                {getPredictionSourceText() ? ` · ${getPredictionSourceText()}` : ""}
              </Text>

              <ResearchNote
                label="Research prediction · not a dosing instruction"
                details="This score comes from a model trained on research data. It estimates the chance of a glucose rise in the next 60 minutes and must not be used to decide an insulin dose."
              />
            </>
          ) : spikeRisk?.status === "stale" ? (
            <View style={styles.stateBox}>
              <StatusPill tone="warning" icon="time" label="Reading too old" />
              <Text style={styles.bodyText}>
                {spikeRisk.message ?? "Your latest reading is too old for a 60-minute estimate."}
                {spikeRisk.age_minutes != null ? ` (about ${Math.round(spikeRisk.age_minutes)} min old)` : ""}
              </Text>
              <Button label="Log new reading" icon="add-circle" size="md" onPress={() => setBgModalVisible(true)} />
            </View>
          ) : spikeRisk?.status === "not_ready" ? (
            <View style={styles.stateBox}>
              <StatusPill tone="brand" icon="hourglass" label={getNotReadyProgressText()} />
              <Text style={styles.bodyText}>
                {spikeRisk.message ??
                  "A few more readings are needed before GlycoVision can estimate your next hour."}
              </Text>
              <Button label="Log reading" icon="add-circle" size="md" variant="secondary" onPress={() => setBgModalVisible(true)} />
            </View>
          ) : (
            <View style={styles.centerRow}>
              <Ionicons name="analytics-outline" size={22} color={colors.textFaint} />
              <Text style={styles.muted}>Not available right now.</Text>
            </View>
          )}
        </Card>
      </Reveal>

      {/* STRESS (from recent voice check) */}
      {stressContext && (
        <Reveal index={7}>
          <Card>
            <StressContextCard
              context={stressContext}
              compact
              onLogBg={() => setBgModalVisible(true)}
              onOpenBolus={() => router.push("/(tabs)/bolus")}
              onVoiceCheck={() => router.push("/(tabs)/voice")}
            />
          </Card>
        </Reveal>
      )}

      {/* ACTIVE INSULIN */}
      <Reveal index={8}>
        <Card>
          <View style={[styles.cardHead, { marginBottom: 4 }]}>
            <IconBadge tone="brand" renderIcon={(c, s) => <MaterialCommunityIcons name="needle" size={s} color={c} />} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardHeadTitle}>Active insulin</Text>
              <Text style={styles.cardHeadSub}>Action time {currentIob?.dia_hours ?? "—"} h</Text>
            </View>
            {loading ? (
              <Skeleton width={60} height={28} />
            ) : (
              <View style={styles.iobRow}>
                <AnimatedNumber
                  value={currentIob?.iob != null ? Number(currentIob.iob) : null}
                  decimals={1}
                  style={styles.iobValue}
                />
                <Text style={styles.iobUnit}> u</Text>
              </View>
            )}
          </View>
          <ResearchNote
            label="Research estimate · not for dosing"
            details="Modelled from logged research bolus entries and your insulin duration (DIA). A logged estimate does not confirm insulin was taken, and this value must not be used to decide a dose."
          />
        </Card>
      </Reveal>

      <LogBgSheet
        visible={bgModalVisible}
        onClose={() => setBgModalVisible(false)}
        lastValue={latestBg}
        onSave={async (value) => {
          await logBg(value);
          haptic.success();
          setBgModalVisible(false);
          // Low / high alerts and recheck reminders.
          onBloodSugarLogged(value);
          await load(true);
          if (value < 70) router.push("/low-help");
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandText: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  avatarText: { fontSize: 15, fontWeight: "800", color: colors.primary },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 14,
  },
  errorBannerText: { flex: 1, fontSize: 14.5, color: colors.dangerText, lineHeight: 20 },
  errorBannerAction: { fontSize: 15, fontWeight: "800", color: colors.dangerText },

  // Low banner
  lowBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#F8D2D2",
    padding: 14,
    marginBottom: 14,
  },
  lowIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  lowTitle: { fontSize: 16.5, fontWeight: "800", color: colors.dangerText },
  lowBody: { fontSize: 14, color: colors.dangerText, marginTop: 2 },

  // Hero
  hero: { padding: 20, borderRadius: radius.xl, marginBottom: 16 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  overline: { fontSize: 12.5, fontWeight: "800", letterSpacing: 1.2, color: colors.textFaint },
  agePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  ageText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  ringWrap: { alignItems: "center", marginTop: 6, marginBottom: 4 },
  heroChips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  trendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  trendChipText: { fontSize: 13.5, fontWeight: "700", color: colors.primary },
  heroAdvice: { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginTop: 12, textAlign: "center" },

  // Quick actions
  quickRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  quick: {
    flex: 1,
    alignItems: "center",
    gap: 9,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  quickPressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
  quickLabel: { fontSize: 13.5, fontWeight: "700", color: colors.text },

  // Today stats
  statsCard: { flexDirection: "row", alignItems: "stretch", paddingVertical: 16, paddingHorizontal: 10 },
  stat: { flex: 1, alignItems: "center", gap: 6 },
  statDivider: { width: 1, backgroundColor: colors.divider, marginVertical: 6 },
  statValueRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 2 },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.text, ...tabular },
  statUnit: { fontSize: 13.5, fontWeight: "700", color: colors.textMuted },
  statLabel: { fontSize: 13.5, fontWeight: "600", color: colors.textMuted },

  // Chart
  chartLegend: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 14, height: 10, borderRadius: 3, borderWidth: 1 },
  legendText: { fontSize: 13, color: colors.textFaint, fontWeight: "600" },

  // Timeline
  tlRow: { flexDirection: "row", alignItems: "stretch" },
  tlTime: { width: 62, fontSize: 12.5, fontWeight: "700", color: colors.textFaint, paddingTop: 16 },
  tlRail: { width: 18, alignItems: "center" },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 19, borderWidth: 2, borderColor: colors.card },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.divider, marginTop: 2 },
  tlCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 10,
    marginLeft: 6,
    marginBottom: 10,
  },
  tlTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  tlDetail: { fontSize: 13, color: colors.textMuted, marginTop: 1 },

  // Shared card pieces
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardHeadTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: colors.text },
  cardHeadSub: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
  bodyText: { fontSize: 15, lineHeight: 23, color: colors.textMuted },
  muted: { fontSize: 15, color: colors.textMuted },
  metaText: { fontSize: 13, color: colors.textFaint, marginTop: 8 },
  centerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  stateBox: { gap: 12, alignItems: "flex-start" },

  nextStepBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.primaryPale,
    borderRadius: radius.md,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  nextStepText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: "700", color: colors.text },
  stressNoteBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: 14,
    marginTop: 10,
  },
  stressNoteText: { flex: 1, fontSize: 14.5, lineHeight: 21, color: colors.warningText },

  // Risk
  riskRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 10 },
  riskScore: { fontSize: 42, fontWeight: "800", color: colors.text, letterSpacing: -1, ...tabular },
  riskPct: { fontSize: 22, fontWeight: "800", color: colors.textMuted, marginLeft: 2 },
  meter: { flexDirection: "row", gap: 6, marginBottom: 12 },
  meterSeg: { flex: 1, height: 8, borderRadius: 4 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  statBoxValue: { fontSize: 19, fontWeight: "800", color: colors.text, ...tabular },
  statBoxLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2, textAlign: "center" },

  // Insulin
  iobRow: { flexDirection: "row", alignItems: "baseline" },
  iobValue: { fontSize: 28, fontWeight: "800", color: colors.primary, ...tabular },
  iobUnit: { fontSize: 16, fontWeight: "700", color: colors.textMuted },

  // Empty states
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 4 },
  emptySub: { fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: 8 },
});
