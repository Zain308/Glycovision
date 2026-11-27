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
  Alert,
  LayoutChangeEvent,
} from "react-native";
import { Text } from "@/components/ui/Typography";

import { Ionicons } from "@expo/vector-icons";

import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
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
import { LogBgSheet } from "@/components/LogBgSheet";
import { NotificationBell } from "@/components/NotificationBell";
import { CarePlanSection } from "@/components/CarePlan";
import { GlucoseRing } from "@/components/GlucoseRing";
import { GlucoseChart, CHART_HEIGHT } from "@/components/GlucoseChart";

import {
  getDashboardSummary,
  getBgHistory,
  logBg,
  getCarePlan,
  deleteEntry,
  getMedicines,
  getTimelineToday,
  type CarePlan,
  type InputKey,
  type BgReading,
  type MedicineDose,
  type TimelineEvent,
} from "@/services/api";

import { colors, radius, shadow, tabular } from "@/constants/theme";
import { glucoseStatus, greeting, timeAgo, RANGE_HIGH, RANGE_LOW } from "@/lib/glucose";
import { haptic } from "@/lib/haptics";
import { onBloodSugarLogged, onForecast, remindToCheck } from "@/lib/notifications";
import { syncNow } from "@/lib/healthConnect";
import { todayLine } from "@/lib/medicines";
import { useOffline } from "@/lib/offline";
import { OfflinePlan, OfflineRow } from "@/components/OfflineCards";

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
  meal: { tone: "brand", icon: (c, s) => <Ionicons name="restaurant-outline" size={s} color={c} /> },
  insulin: { tone: "brand", icon: (c, s) => <Ionicons name="eyedrop-outline" size={s} color={c} /> },
  bg: { tone: "success", icon: (c, s) => <Ionicons name="water-outline" size={s} color={c} /> },
};

function Timeline({ events, onPick }: { events: TimelineEvent[]; onPick: (e: TimelineEvent) => void }) {
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
            <Pressable
              onPress={() => onPick(e)}
              accessibilityRole="button"
              accessibilityLabel={`${e.title}, ${time}. Tap to delete`}
              style={({ pressed }) => [styles.tlCard, last && { marginBottom: 0 }, pressed && { opacity: 0.7 }]}
            >
              <IconBadge renderIcon={s.icon} tone={tone} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tlTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.tlDetail} numberOfLines={1}>
                  {e.detail}
                </Text>
              </View>
              <Ionicons name="ellipsis-vertical" size={18} color={colors.textFaint} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------

export default function DashboardScreen() {
  const [summary, setSummary] = useState<any>(null);

  const [bgHistory, setBgHistory] = useState<BgReading[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [bgModalVisible, setBgModalVisible] = useState(false);

  const [bgInput, setBgInput] = useState("");

  const [savingBg, setSavingBg] = useState(false);

  // A ref, not just state: two quick taps can both run before the
  // re-render that disables the button, logging the reading twice.
  const savingBgRef = useRef(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Forecast -> insulin -> activity (backend services/care_plan).
  const [plan, setPlan] = useState<CarePlan | null>(null);
  const [planError, setPlanError] = useState(false);
  // "What if I eat…": a preview meal in grams (0 = the real plan).
  const [previewCarbs, setPreviewCarbs] = useState(0);
  const [planBusy, setPlanBusy] = useState(false);
  const planRequest = useRef(0);

  // Today's meals, insulin and readings for the timeline.
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);

  const [doses, setDoses] = useState<MedicineDose[]>([]);
  const [allDay, setAllDay] = useState(false);

  // A wrong or doubled entry changes the forecast and the next dose.
  const askDelete = (e: TimelineEvent) =>
    Alert.alert(
      `Delete ${e.title}?`,
      e.type === "insulin"
        ? "Only if it was logged by mistake. Insulin you really took must stay, or the next dose suggestion will be too high."
        : "Only if it was logged by mistake or twice.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteEntry(e)
              .then(() => {
                haptic.success();
                load(true);
              })
              .catch((error) => Alert.alert("Not deleted", error instanceof Error ? error.message : "Try again.")),
        },
      ],
    );

  // Other screens (e.g. Voice) open the "Log blood sugar" popup by
  // navigating here with ?logBg=1.
  const { logBg: openLogBg } = useLocalSearchParams<{ logBg?: string }>();

  useEffect(() => {
    if (openLogBg === "1") {
      setBgModalVisible(true);
      router.setParams({ logBg: undefined });
    }
  }, [openLogBg]);

  // Back online, or the last waiting entry was uploaded: show fresh data.
  const net = useOffline();
  const behind = net.offline || net.waiting.length > 0 || net.savedAt != null;
  const wasBehind = useRef(false);
  const caughtUpAt = useRef(0);
  useEffect(() => {
    // At most every 30 s: a server that is always slow must not loop this.
    if (wasBehind.current && !behind && Date.now() - caughtUpAt.current > 30_000) {
      caughtUpAt.current = Date.now();
      loadRef.current?.(true);
    }
    wasBehind.current = behind;
  }, [behind]);
  const loadRef = useRef<((force?: boolean) => void) | null>(null);

  // Prevent overlapping dashboard requests.
  const loadInFlightRef = useRef(false);

  // Avoid immediately repeating focus-triggered requests.
  const lastLoadAtRef = useRef(0);

  const loadPlan = useCallback(async () => {
    const fetchPlan = async () => {
      const mine = ++planRequest.current;
      const next = await getCarePlan();
      if (mine !== planRequest.current) return; // a newer plan was asked for
      setPlan(next);
      setPreviewCarbs(0);
      setPlanBusy(false);
      setPlanError(false);
      // Warn about a likely spike or low (rate-limited in the helper).
      onForecast(next.forecast);
    };
    try {
      await fetchPlan();
      // Then bring in new steps and heart rate, and refresh if there were any.
      if ((await syncNow()) > 0) await fetchPlan();
    } catch (error) {
      console.log("Care plan unavailable:", error);
      // An old forecast or dose must never stay on screen.
      planRequest.current++;
      setPlan(null);
      setPreviewCarbs(0);
      setPlanBusy(false);
      setPlanError(true);
    }
  }, []);

  const tryMeal = useCallback(async (carbs: number) => {
    const mine = ++planRequest.current;
    setPlanBusy(true);
    try {
      const next = await getCarePlan(carbs || undefined);
      if (mine !== planRequest.current) return;
      setPlan(next);
      setPreviewCarbs(carbs);
    } catch (error) {
      console.log("Preview unavailable:", error);
      if (mine === planRequest.current) Alert.alert("Couldn't load the preview", "Check your internet connection and try again.");
    } finally {
      if (mine === planRequest.current) setPlanBusy(false);
    }
  }, []);

  const openInput = (key: InputKey) => {
    if (key === "sugar") setBgModalVisible(true);
    else if (key === "food") router.push("/(tabs)/scanner");
    else if (key === "stress") router.push("/(tabs)/voice");
    else if (key === "insulin") router.push("/(tabs)/bolus");
    else if (key === "activity") router.push("/(tabs)/fitness" as any);
    else router.push("/(tabs)/profile");
  };

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
      const [dashboardData, historyData] = await Promise.all([
        getDashboardSummary(),
        getBgHistory(24),
      ]);

      setSummary(dashboardData);

      setLoadError(null);

      setBgHistory(historyData.readings ?? []);

      // Timeline loads alongside; a failure only hides that section.
      getTimelineToday()
        .then(setTimeline)
        .catch((error) => {
          console.log("Timeline unavailable:", error);
          setTimeline([]);
        });

      // The plan loads alongside, so the rest of the screen never waits for it.
      loadPlan();
      getMedicines()
        .then((m) => setDoses(m.today))
        .catch((error) => console.log("Medicines unavailable:", error));

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
  }, [loadPlan]);

  loadRef.current = load;

  // -------------------------------------------------------
  // INITIAL LOAD
  // -------------------------------------------------------

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const loadDashboard = async () => {
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
  // Readings first: they include ones still waiting to upload.
  const latestBg: number | null = latestReading?.value ?? summary?.latest_bg ?? null;
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
  const medLine = todayLine(doses);
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

      <OfflineRow />

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
            renderIcon={(c, s) => <Ionicons name="camera-outline" size={s} color={c} />}
          />
          <QuickAction
            label="Log sugar"
            tone="brand"
            onPress={() => setBgModalVisible(true)}
            renderIcon={(c, s) => <Ionicons name="water-outline" size={s} color={c} />}
          />
          <QuickAction
            label="Bolus"
            tone="brand"
            onPress={() => router.push("/(tabs)/bolus")}
            renderIcon={(c, s) => <Ionicons name="calculator-outline" size={s} color={c} />}
          />
          <QuickAction
            label="Voice"
            tone="brand"
            onPress={() => router.push("/(tabs)/voice")}
            renderIcon={(c, s) => <Ionicons name="mic-outline" size={s} color={c} />}
          />
        </View>
      </Reveal>

      {/* MEDICINES DUE */}
      {medLine ? (
        <Pressable
          onPress={() => router.push("/medicines" as any)}
          accessibilityRole="button"
          accessibilityLabel={`Medicines. ${medLine.text}`}
          style={({ pressed }) => [styles.medRow, medLine.attention && styles.medDue, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="medical-outline" size={22} color={medLine.attention ? colors.warningText : colors.primary} />
          <Text style={[styles.medText, medLine.attention && { color: colors.warningText }]} numberOfLines={2}>
            {medLine.text}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={medLine.attention ? colors.warningText : colors.textFaint} />
        </Pressable>
      ) : null}

      {/* THE PLAN: inputs -> 1 sugar -> 2 insulin -> 3 activity */}
      <Reveal index={2}>
        <SectionHeader title="Your plan" />
        {plan ? (
          <CarePlanSection
            plan={plan}
            carbs={previewCarbs}
            busy={planBusy}
            onWhatIf={tryMeal}
            onInput={openInput}
            onRemind={async (minutes) => {
              haptic.success();
              const ok = await remindToCheck(minutes);
              Alert.alert(ok ? "Reminder set" : "Reminders are off", ok ? `We'll remind you in ${minutes} minutes.` : "Turn on notifications for GlycoVision in your phone settings.");
            }}
            onLog={() => setBgModalVisible(true)}
            onProfile={() => router.push("/(tabs)/profile")}
            onBolus={() => router.push("/(tabs)/bolus")}
            onActivity={() => router.push("/activity" as any)}
          />
        ) : (
          <Card>
            {planError && net.offline ? (
              <OfflinePlan events={timeline ?? []} />
            ) : planError ? (
              <Text style={styles.muted}>Your plan isn’t available right now. Pull down to try again.</Text>
            ) : (
              <View style={styles.centerRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.muted}>Working out your next hour…</Text>
              </View>
            )}
          </Card>
        )}
      </Reveal>

      {/* TODAY */}
      <Reveal index={2}>
        <SectionHeader title="Today" />
        <Card style={styles.statsCard}>
          <TodayStat
            label="In range"
            value={summary?.time_in_range_pct ?? null}
            unit="%"
            tone="brand"
            renderIcon={(c, s) => <Ionicons name="checkmark-circle-outline" size={s} color={c} />}
          />
          <View style={styles.statDivider} />
          <TodayStat
            label="Carbs"
            value={summary ? Number(summary.total_carbs_today ?? 0) : null}
            unit="g"
            tone="brand"
            renderIcon={(c, s) => <Ionicons name="restaurant-outline" size={s} color={c} />}
          />
          <View style={styles.statDivider} />
          <TodayStat
            label="Insulin"
            value={summary ? Number(summary.total_insulin_today ?? 0) : null}
            unit="u"
            decimals={1}
            tone="brand"
            renderIcon={(c, s) => <Ionicons name="eyedrop-outline" size={s} color={c} />}
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
            <>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={styles.legendText}>In range {RANGE_LOW}–{RANGE_HIGH}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                <Text style={styles.legendText}>High</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
                <Text style={styles.legendText}>Low</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendDash} />
                <Text style={styles.legendText}>No readings</Text>
              </View>
            </View>
            <Text style={styles.chartHint}>
              {bgHistory.length} {bgHistory.length === 1 ? "reading" : "readings"} · tap the chart to see a value
            </Text>
            </>
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
            <>
              <Timeline events={allDay ? timeline : timeline.slice(0, 6)} onPick={askDelete} />
              {timeline.length > 6 ? (
                <Button
                  label={allDay ? "Show less" : `Show all ${timeline.length}`}
                  icon={allDay ? "chevron-up" : "chevron-down"}
                  size="md"
                  variant="ghost"
                  onPress={() => setAllDay(!allDay)}
                  style={{ marginTop: 8 }}
                />
              ) : null}
            </>
          ) : (
            <View style={styles.emptyState}>
              <IconBadge icon="calendar-outline" tone="brand" size={56} />
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

      <LogBgSheet
        visible={bgModalVisible}
        onClose={() => setBgModalVisible(false)}
        lastValue={latestBg}
        onSave={async (value) => {
          // The same number a moment ago is usually a double tap.
          const prev = latestReading;
          if (prev && Math.round(prev.value) === Math.round(value) && Date.now() - new Date(prev.logged_at).getTime() < 5 * 60_000) {
            const again = await new Promise<boolean>((done) =>
              Alert.alert(`You logged ${value} a moment ago`, "Save it again as a new reading?", [
                { text: "No", style: "cancel", onPress: () => done(false) },
                { text: "Save again", onPress: () => done(true) },
              ], { cancelable: true, onDismiss: () => done(false) }),
            );
            if (!again) {
              setBgModalVisible(false);
              return;
            }
          }
          // Low / high alerts and recheck reminders never wait for internet.
          onBloodSugarLogged(value);
          if (value < 70) {
            logBg(value)
              .then(() => load(true))
              .catch(() => Alert.alert("Reading not saved", "Treat your low first. Then log this reading again."));
            setBgModalVisible(false);
            router.push("/low-help");
            return;
          }
          await logBg(value);
          haptic.success();
          setBgModalVisible(false);
          await load(true);
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

  // Medicines
  medRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 54,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 6,
  },
  medDue: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft },
  medText: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },

  // Today stats
  statsCard: { flexDirection: "row", alignItems: "stretch", paddingVertical: 16, paddingHorizontal: 10 },
  stat: { flex: 1, alignItems: "center", gap: 6 },
  statDivider: { width: 1, backgroundColor: colors.divider, marginVertical: 6 },
  statValueRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 2 },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.text, ...tabular },
  statUnit: { fontSize: 13.5, fontWeight: "700", color: colors.textMuted },
  statLabel: { fontSize: 13.5, fontWeight: "600", color: colors.textMuted },

  // Chart
  chartLegend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 6, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendDash: { width: 16, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.textFaint },
  chartHint: { fontSize: 13, color: colors.textFaint, marginTop: 6 },
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
