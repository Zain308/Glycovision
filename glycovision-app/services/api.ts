import { storedSession, supabase } from "@/lib/supabase";
import { copyOf, flush, isDisconnected, isOffline, keepCopy, OfflineError, offlineState, openOutbox, reached, removeWaiting, requireSynced, send, setUploader, showingCopy, type Entry, type UploadResult } from "@/lib/offline";
import { sameDay, withMedicines, withReadings, withSummary, withTimeline, type Summary } from "@/lib/offlineView";
import { API_URL } from "@/lib/config";
import * as FileSystem from "expo-file-system/legacy";


// ---------------------------------------------------------
// BASE URL
// ---------------------------------------------------------

// Set in .env as EXPO_PUBLIC_API_URL (see lib/config.ts).
export const BASE_URL = API_URL;


// ---------------------------------------------------------
// RELIABLE FETCH
// ---------------------------------------------------------
// Every request in this file goes through this `fetch` (it shadows the
// global one inside this module):
//   * gives up after 20 s (60 s for photo uploads) instead of hanging
//   * retries a GET once after a short pause (flaky mobile networks)
//   * turns network failures into plain-language errors
//   * fails at once when the phone has no connection
// POSTs are never repeated here. Logging goes through lib/offline.ts, whose ids
// let the server store each entry once.

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (isDisconnected()) throw new OfflineError();
  const method = (init.method ?? "GET").toUpperCase();
  const isUpload = typeof FormData !== "undefined" && init.body instanceof FormData;
  const timeoutMs = isUpload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const attempts = method === "GET" ? 2 : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await globalThis.fetch(input, { ...init, signal: init.signal ?? controller.signal });
      reached(true);
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 800));
    } finally {
      clearTimeout(timer);
    }
  }

  const aborted = (lastError as { name?: string })?.name === "AbortError";
  reached(false);
  throw new OfflineError(aborted ? "The server took too long to answer. Check your internet and try again." : undefined);
}


// ---------------------------------------------------------
// TYPES
// ---------------------------------------------------------

export interface PatientState {
  current_bg: number;
  target_bg: number;
  isf: number;
  iob: number;
  total_carbs: number;
  icr: number;
}


export interface Profile {
  id?: string;

  full_name?: string;
  diabetes_type?: string;

  icr?: number;
  isf?: number;
  target_bg?: number;
  dia_hours?: number;

  sex?: 'male' | 'female' | null;
  birth_year?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  mealtime_insulin?: boolean | null;
  insulin_type?: InsulinType | null;
  disclaimer_accepted_at?: string | null;

  created_at?: string;
  updated_at?: string;
}


export type InsulinType = 'rapid' | 'regular' | 'premixed' | 'other';

export interface ProfileUpdate {
  step_goal?: number;
  heart_goal?: number;
  full_name?: string;
  diabetes_type?: string;

  icr?: number;
  isf?: number;
  target_bg?: number;
  dia_hours?: number;

  sex?: 'male' | 'female';
  birth_year?: number;
  height_cm?: number;
  weight_kg?: number;
  mealtime_insulin?: boolean;
  insulin_type?: InsulinType;
  disclaimer_accepted_at?: string;
}


export interface MealLogPayload {
  food_name: string;
  carbs: number;

  protein?: number;
  fat?: number;
  calories?: number;
}


export interface BolusLogPayload {
  dose_units: number;

  carbs?: number;
  current_bg?: number;
}


export interface BgReading {
  id?: string | number;
  value: number;
  logged_at: string;
}


export interface BgHistoryResponse {
  window_hours: number;
  count: number;
  readings: BgReading[];
}


// ---------------------------------------------------------
// AUTH HEADER
// ---------------------------------------------------------

const LOGIN_WAIT_MS = 8_000;

async function authHeaders() {
  if (isDisconnected()) throw new OfflineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { data, error } = await Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, no) => (timer = setTimeout(() => (reached(false), no(new OfflineError())), LOGIN_WAIT_MS))),
  ]).finally(() => clearTimeout(timer));

  if (error) {
    // The token could not be renewed only because there is no internet.
    if (error.name === "AuthRetryableFetchError") {
      reached(false);
      throw new OfflineError();
    }
    throw new Error(
      `Could not read authentication session: ${error.message}`
    );
  }

  if (!data.session) {
    throw new Error(
      "Not logged in — please log in again."
    );
  }

  return {
    Authorization:
      `Bearer ${data.session.access_token}`,
  };
}


// ---------------------------------------------------------
// WITHOUT INTERNET (lib/offline.ts)
// ---------------------------------------------------------

const currentUid = async () => (await storedSession())?.user.id ?? null;

const PATIENT_MS = 4000;
const IMPATIENT_MS = 1500;
const LATE = Symbol("late");

/** The result, or LATE when it takes longer (the work goes on). */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<typeof LATE>((r) => (timer = setTimeout(() => r(LATE), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * Newest data, or the copy kept on this phone when there is no internet.
 * `show` adds what is still waiting to upload and checks the copy's age.
 */
async function read<T>(path: string, what: string, show: (data: T, at: number, waiting: Entry[]) => T = (d) => d): Promise<T> {
  const uid = await currentUid();
  if (!uid) return getJson<T>(path, what);
  await openOutbox(uid);
  const copy = await copyOf<T>(uid, path);
  const now = () => offlineState().waiting;
  // With a copy to show, nobody waits long on a bad connection.
  const patience = !copy ? null : offlineState().offline ? IMPATIENT_MS : PATIENT_MS;
  const live = (async () => {
    if (now().length) await within(flush().catch(() => {}), 5000);
    const data = await getJson<T>(path, what);
    keepCopy(uid, path, data);
    return data;
  })();
  try {
    const data = patience == null ? await live : await within(live, patience);
    if (data !== LATE) return now().length ? show(data as T, Date.now(), now()) : (data as T);
    live.catch(() => {});
  } catch (e) {
    if (!copy || !isOffline(e)) throw e;
  }
  showingCopy(copy!.at);
  return show(copy!.data, copy!.at, now());
}

async function synced() {
  const uid = await currentUid();
  if (uid) await openOutbox(uid);
  await requireSynced();
}

/** Save on the phone, then upload now or when internet is back. */
async function log(kind: Entry["kind"], path: string, body: Record<string, any>, group?: string): Promise<any> {
  const uid = await currentUid();
  if (!uid) throw new Error("Not logged in — please log in again.");
  return send(uid, kind, path, body, group);
}

const plain = async (res: Response) => {
  const text = await res.text().catch(() => "");
  try {
    const detail = JSON.parse(text).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // not JSON
  }
  return "The server did not accept this entry.";
};

setUploader(async (entry, age, uid): Promise<UploadResult> => {
  try {
    const headers = await authHeaders();
    // Never upload one person's entry with another person's login.
    if ((await currentUid()) !== uid) return { type: "no_internet" };
    const res = await fetch(`${BASE_URL}/api/v1${entry.path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry.body, client_id: entry.id, ...(age == null ? {} : { age_seconds: Math.round(age) }) }),
    });
    if (res.ok) return { type: "ok", data: await res.json().catch(() => ({ status: "logged" })) };
    if (res.status === 401 || res.status === 403) return { type: "no_internet" };
    if (res.status >= 500 || res.status === 408 || res.status === 429) return { type: "later", message: res.status === 503 ? await plain(res) : undefined };
    return { type: "refused", message: await plain(res) };
  } catch (e) {
    return isOffline(e) ? { type: "no_internet" } : { type: "later" };
  }
});

const todayOnly = <T>(data: T, at: number): T => {
  if (!sameDay(at, Date.now())) throw new OfflineError();
  return data;
};

/** Fetched ahead, so they are there when the internet is not. */
export async function keepForLater() {
  await Promise.allSettled([getProfile(), getFoodLibrary(), getMedicines(), getBgHistory(24)]);
}


// ---------------------------------------------------------
// MEAL ANALYSIS
// ---------------------------------------------------------

export type MealAnalysisStage =
  | "uploading"
  | "analyzing";

function guessImageMimeType(uri: string): string {
  const extension =
    uri.split("?")[0].split(".").pop()?.toLowerCase();

  switch (extension) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
    case "heif":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

export async function analyzeMeal(
  uri: string,
  options: {
    mimeType?: string | null;
    onStage?: (stage: MealAnalysisStage) => void;
  } = {}
): Promise<any> {
  const headers = await authHeaders();

  options.onStage?.("uploading");

  // Android / Expo can reject React Native file objects inside FormData
  // with "Unsupported FormDataPart implementation".
  // Use Expo FileSystem multipart upload instead, matching the proven
  // upload approach used elsewhere in the app.
  const submitResult = await FileSystem.uploadAsync(
    `${BASE_URL}/api/v1/analyze-meal-async`,
    uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType:
        options.mimeType || guessImageMimeType(uri),
      headers,
    }
  );

  if (
    submitResult.status < 200 ||
    submitResult.status >= 300
  ) {
    throw new Error(
      `Meal submission failed (${submitResult.status}): ${submitResult.body}`
    );
  }

  let submission: any;

  try {
    submission = JSON.parse(
      submitResult.body
    );
  } catch {
    throw new Error(
      "Meal submission returned an invalid response."
    );
  }

  const job_id =
    submission?.job_id;

  if (!job_id) {
    throw new Error(
      "Meal submission did not return a job ID."
    );
  }

  options.onStage?.("analyzing");

  // Poll every 3 seconds.
  // Maximum: 100 attempts = about 5 minutes.
  const maxAttempts = 100;

  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {
    await new Promise(
      (resolve) =>
        setTimeout(resolve, 3000)
    );

    const statusRes = await fetch(
      `${BASE_URL}/api/v1/analysis-status/${job_id}`,
      {
        headers:
          await authHeaders(),
      }
    );

    if (!statusRes.ok) {
      throw new Error(
        `Status check failed: ${await statusRes.text()}`
      );
    }

    const job =
      await statusRes.json();

    if (
      job.status === "complete"
    ) {
      return job.result;
    }

    if (
      job.status === "error"
    ) {
      throw new Error(
        job.error ||
          "Meal analysis failed."
      );
    }
  }

  throw new Error(
    "Analysis took too long — please try again."
  );
}


// ---------------------------------------------------------
// BOLUS / INTERVENTION
// ---------------------------------------------------------

export async function calculateIntervention(
  payload: PatientState
) {
  // Insulin or food still on the phone would make the dose wrong.
  await synced();
  const res = await fetch(
    `${BASE_URL}/api/v1/calculate-intervention`,
    {
      method: "POST",

      headers: {
        ...(await authHeaders()),
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(
        payload
      ),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Bolus calculation failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------

export const getDashboardSummary = () =>
  read<Summary>("/dashboard-summary", "Dashboard", (d, at, waiting) => withSummary(d, at, waiting, Date.now()));


// ---------------------------------------------------------
// MEAL LOGGING
// ---------------------------------------------------------

export const logMeal = (meal: MealLogPayload) => log("meal", "/log-meal", { ...meal });


// ---------------------------------------------------------
// DISH PICKED BY THE USER (scanner was unsure)
// ---------------------------------------------------------

export interface DishSuggestion {
  food_name: string;
  display_name: string;
  confidence: number;
}

// Same result shape as analyzeMeal, for a dish the user chose.
export async function getDishNutrition(
  suggestion: DishSuggestion
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/dish-nutrition/${encodeURIComponent(suggestion.food_name)}` +
      `?confidence=${suggestion.confidence}`,
    {
      headers:
        await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Dish lookup failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// TODAY TIMELINE (meals, insulin, readings)
// ---------------------------------------------------------

export interface TimelineEvent {
  /** Server id, or "local:<id>" while it waits on the phone. */
  id?: number | string;
  type: "meal" | "insulin" | "bg";
  title: string;
  detail: string;
  value?: number;
  logged_at: string;
}

export const getTimelineToday = async (): Promise<TimelineEvent[]> =>
  (
    await read<{ events: TimelineEvent[] }>("/timeline-today", "Timeline", (d, at, waiting) => ({
      events: withTimeline(d.events ?? [], at, waiting, Date.now()),
    }))
  ).events ?? [];


// ---------------------------------------------------------
// FOOD LIBRARY
// ---------------------------------------------------------

export interface LibraryFood {
  food_name: string;
  display_name: string;
  portion: { unit: string; unit_plural: string; unit_grams: number; kind: string };
  per_portion: { calories: number; carbs: number; protein: number; fat: number; fiber: number };
  per_100g: { calories: number; carbs: number; protein: number; fat: number; fiber: number };
  match: string;
  source: string;
}

export const getFoodLibrary = async (): Promise<LibraryFood[]> =>
  (await read<{ foods: LibraryFood[] }>("/foods", "Food library")).foods;


// ---------------------------------------------------------
// PROFILE
// ---------------------------------------------------------

export const getProfile = () => read<Profile>("/profile", "Profile");


export async function updateProfile(
  payload: ProfileUpdate
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/profile`,
    {
      method: "PUT",

      headers: {
        ...(await authHeaders()),
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(
        payload
      ),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Profile update failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// BOLUS LOGGING
// ---------------------------------------------------------

export const logBolus = (payload: BolusLogPayload) => log("bolus", "/log-bolus", { ...payload });


// ---------------------------------------------------------
// BLOOD GLUCOSE
// ---------------------------------------------------------

export const logBg = (value: number) => log("bg", "/log-bg", { value });

export const getBgHistory = (hours = 24) =>
  read<BgHistoryResponse>(`/bg-history?hours=${hours}`, "BG history", (d, _at, waiting) => {
    const readings = withReadings(d.readings ?? [], waiting, hours, Date.now());
    return { ...d, readings, count: readings.length };
  });


// ---------------------------------------------------------
// INSULIN ON BOARD
// ---------------------------------------------------------

export async function getCurrentIob() {
  await synced();
  const res = await fetch(
    `${BASE_URL}/api/v1/current-iob`,
    {
      headers:
        await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `IOB fetch failed: ${await res.text()}`
    );
  }

  return res.json();
}

export async function getPatientSnapshot() {
  const res = await fetch(
    `${BASE_URL}/api/v1/patient-snapshot`,
    {
      headers: await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Patient snapshot failed: ${await res.text()}`
    );
  }

  return res.json();
}

export async function generateTrainingSamples(
  days: number = 30
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/generate-training-samples?days=${days}`,
    {
      method: "POST",
      headers: await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Training sample generation failed: ${await res.text()}`
    );
  }

  return res.json();
}



export async function getSpikeModelInfo() {
  const res = await fetch(
    `${BASE_URL}/api/v1/app-spike-model-info`,
    {
      headers: await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Spike model info failed: ${await res.text()}`
    );
  }

  return res.json();
}


export async function getSpikeRisk() {
  const res = await fetch(
    `${BASE_URL}/api/v1/spike-risk`,
    {
      headers: await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Spike risk failed: ${await res.text()}`
    );
  }

  return res.json();
}

export async function getSpikeIntervention() {
  const headers =
    await authHeaders();

  const response =
    await fetch(
      `${BASE_URL}/api/v1/spike-intervention`,
      {
        method: "GET",
        headers,
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Spike intervention failed: ${text}`
    );
  }

  return response.json();
}


// ---------------------------------------------------------
// STRESS CONTEXT (from recent voice checks)
// ---------------------------------------------------------

export type StressLevel = "calm" | "possible" | "elevated";

export interface StressContext {
  status: "recent" | "no_recent_check";
  level: StressLevel | null;
  basis?: "personal_baseline" | "single_recording";
  checked_at?: string;
  age_minutes?: number;
  headline: string;
  summary: string;
  suggestions: string[];
  // Note shown beside a bolus estimate; the dose itself never changes.
  bolus_note: string | null;
  disclaimer?: string;
}

export async function getStressContext(): Promise<StressContext> {
  const res = await fetch(
    `${BASE_URL}/api/v1/stress-context`,
    {
      headers: await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Stress context failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// CARE PLAN: forecast -> insulin -> activity
// ---------------------------------------------------------

export interface ForecastPoint {
  minute: number;
  low: number;
  mid: number;
  high: number;
}

export interface Forecast {
  status: 'ready' | 'stale' | 'no_reading';
  message: string;
  title?: string;
  alert?: 'urgent' | 'high' | 'watch' | 'calm';
  current_bg?: number;
  reading_at?: string;
  points?: ForecastPoint[];
  direction?: 'up' | 'down' | 'steady';
  change_60?: number;
  range_60?: [number, number];
  peak?: { minute: number; bg: number };
  lowest?: { minute: number; bg: number };
  spike_probability?: number;
  low_probability?: number;
  based_on?: string;
  typical_error_60?: number;
  range_coverage?: number;
  used_watch?: boolean;
  carbs_counted?: number;
  disclaimer?: string;
  /** Each input's share of change_60 in mg/dL; they add up to it. */
  effects?: { trend: number; food: number; insulin: number; stress: number; movement: number };
  history?: { minute: number; bg: number }[];
}

export type InputKey = 'sugar' | 'food' | 'stress' | 'activity' | 'body' | 'insulin';
export type OutputKey = 'forecast' | 'insulin' | 'move';

export interface PlanInput {
  key: InputKey;
  label: string;
  ready: boolean;
  value: string | null;
  unit: string;
  note: string;
  effect: number | null | undefined;
  kcal_today?: number;
}

export interface PlanLink {
  from: InputKey | OutputKey;
  to: OutputKey;
  text: string;
  used: boolean;
}

/** Things from the last hour; minutes count from the latest reading. */
export interface PlanEvent {
  kind: 'food' | 'insulin' | 'activity';
  minute: number;
  label: string;
  amount: number;
}

export interface DoseTest {
  formula_units: number;
  units: number;
  lowered: boolean;
  peak_without: number;
  peak_with: number;
  lowest_with: number;
  end_without: number;
  end_with: number;
  hours: number;
  path_without: { minute: number; bg: number }[];
  path_with: { minute: number; bg: number }[];
}

export interface InsulinPlan {
  status: 'dose' | 'none_needed' | 'hold' | 'blocked_low' | 'need_reading' | 'setup' | 'unsupported' | 'not_needed';
  message: string;
  units?: number;
  iob?: number;
  carbs?: number;
  meal_name?: string | null;
  starts?: string;
  strongest?: string;
  dia_hours?: number;
  weight_check?: string | null;
  breakdown?: { carb_dose_units: number; correction_dose_units: number; iob_subtracted: number };
  flags?: string[];
  test?: DoseTest;
  disclaimer?: string;
}

export interface ActivityOption {
  key: string;
  name: string;
  minutes: number;
  intensity: string;
  why: string;
  kcal: number | null;
}

export interface ActivityPlan {
  status: 'go' | 'caution' | 'blocked' | 'need_reading';
  headline: string;
  why: string;
  options: ActivityOption[];
  safety: string[];
}

export interface ActivityToday {
  connected: boolean;
  steps: number | null;
  active_kcal: number | null;
  heart_rate: number | null;
  manual_minutes: number;
  manual: { activity: string; minutes: number; logged_at: string }[];
  last_sync: string | null;
}

export interface StressGauge {
  level: StressLevel | null;
  basis: string | null;
  voice_level: StressLevel | null;
  heart_sign: string;
  heart_reason: string;
  heart_rate: number | null;
  resting_heart_rate: number | null;
  disclaimer: string;
}

export interface BodyMetrics {
  complete: boolean;
  missing: string[];
  bmi: number | null;
  bmi_group: string | null;
  bmi_label: string | null;
  healthy_weight_kg: [number, number] | null;
  bmr_kcal: number | null;
}

export interface CarePlan {
  forecast: Forecast;
  insulin: InsulinPlan;
  activity: ActivityPlan;
  stress: StressGauge | null;
  today: ActivityToday;
  body: BodyMetrics;
  disclaimer: string;
  inputs: PlanInput[];
  links: PlanLink[];
  events: PlanEvent[];
  recheck_minutes: number | null;
}

export interface HealthSample {
  kind: 'steps' | 'heart_rate' | 'active_kcal' | 'distance_m' | 'move_min' | 'heart_pts';
  time: string;
  value: number;
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`${what} failed: ${await res.text()}`);
  return res.json();
}

async function postJson<T>(path: string, body: unknown, what: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${what} failed: ${await res.text()}`);
  return res.json();
}

/** `carbs`: a meal the user is thinking of eating (nothing is saved). */
export async function getCarePlan(carbs?: number) {
  // Never from a saved copy, and never without every entry.
  await synced();
  return getJson<CarePlan>(carbs ? `/care-plan?carbs=${carbs}` : '/care-plan', 'Care plan');
}
export const getActivityToday = () => read<ActivityToday>('/activity-today', 'Activity', todayOnly);
export const getStressGauge = () => getJson<StressGauge>('/stress-gauge', 'Stress gauge');
export const syncHealth = (data: { samples: HealthSample[]; sessions?: HealthSession[]; days?: HealthDayTotal[]; vitals?: HealthVital[]; glucose?: { time: string; value: number }[] }) =>
  postJson<{ buckets: number; glucose?: number }>('/health-sync', data, 'Health sync');
export const logActivity = (activity: string, minutes: number, extra: { steps?: number; distance_m?: number; kcal?: number } = {}) =>
  log('activity', '/log-activity', { activity, minutes, ...extra });

// ---------------------------------------------------------
// FITNESS
// ---------------------------------------------------------

export interface HealthSession {
  kind: 'sleep' | 'exercise';
  start: string;
  end: string;
  title?: string;
  deep_min?: number;
  rem_min?: number;
  awake_min?: number;
}

export interface HealthDayTotal {
  day: string;
  steps?: number;
  distance_m?: number;
  active_kcal?: number;
}

export type VitalKind = 'weight' | 'blood_pressure' | 'hba1c' | 'sleep';

export interface HealthVital {
  kind: VitalKind;
  value: number;
  value2?: number;
  time: string;
}

export interface FitnessDay {
  day: string;
  steps: number | null;
  distance_m: number | null;
  active_kcal: number | null;
  move_min: number | null;
  heart_pts: number | null;
  active_hours: number | null;
  longest_sit_min: number | null;
  hr_min: number | null;
  hr_max: number | null;
  hr_resting: number | null;
}

export interface Vital {
  id: number;
  value: number;
  value2: number | null;
  logged_at: string;
  source: string;
  level?: string;
  text?: string;
}

export interface Fitness {
  today: Omit<FitnessDay, 'day'> & {
    hourly: number[];
    distance_estimated: boolean;
    kcal_estimated: boolean;
    sitting_min: number | null;
    last_sync: string | null;
  };
  goals: { steps: number; heart_pts: number };
  status: { level: 'unknown' | 'early' | 'active' | 'on_track' | 'low' | 'sitting'; title: string; text: string };
  week: {
    level: 'learning' | 'active' | 'some' | 'inactive';
    title: string;
    text: string;
    heart_pts: number;
    goal: number;
    active_days: number;
    days_known: number;
    quiet_days: number;
    average_steps?: number | null;
  };
  streak: number;
  days: FitnessDay[];
  sugar_effect: {
    status: 'learning' | 'lower' | 'higher' | 'same';
    text: string;
    days: number;
    quiet_avg?: number;
    busy_avg?: number;
    quiet_steps?: number;
    busy_steps?: number;
    difference?: number;
  };
  sleep: { minutes: number; level: string; text: string; deep_min: number | null; rem_min: number | null; source: string } | null;
  journal: {
    id: number | null;
    activity: string;
    minutes: number;
    steps: number | null;
    distance_m: number | null;
    kcal: number | null;
    source: 'you' | 'watch';
    ended_at: string;
  }[];
  vitals: Partial<Record<VitalKind, Vital>>;
  weight_history: { value: number; logged_at: string }[];
}

// ---------------------------------------------------------
// MEDICINES, REPORT, OWN DATA
// ---------------------------------------------------------

export interface Medicine {
  id: number;
  name: string;
  dose: string | null;
  times: string[];
  note: string | null;
}

export interface MedicineDose {
  medicine_id: number;
  name: string;
  dose: string | null;
  time: string;
  state: 'taken' | 'skipped' | 'missed' | 'due' | 'later';
}

export interface MedicineOverview {
  medicines: Medicine[];
  today: MedicineDose[];
  adherence: { taken: number; planned: number; percent: number | null; days: number };
  day: string;
}

export interface DoctorReport {
  period: { days: number; from: string; to: string };
  patient: {
    name: string | null;
    diabetes_type: string | null;
    sex: string | null;
    age: number | null;
    height_cm: number | null;
    weight_kg: number | null;
    bmi: number | null;
    icr: number | null;
    isf: number | null;
    target_bg: number | null;
    insulin_type: string | null;
    mealtime_insulin: boolean | null;
  };
  glucose: {
    count: number;
    days?: number;
    per_day?: number;
    average?: number;
    sd?: number;
    cv?: number | null;
    lowest?: number;
    highest?: number;
    very_low?: number;
    low?: number;
    in_range?: number;
    high?: number;
    very_high?: number;
    sensor?: boolean;
    gmi?: number | null;
    daily?: { day: string; average: number; min: number; max: number; count: number }[];
    by_part?: { part: string; average: number | null; count: number; low: number; high: number }[];
    low_events?: { value: number; at: string }[];
  };
  insulin: { doses: number; per_day: number | null; days: number };
  meals: { count: number; carbs_per_day: number | null; days: number };
  activity: { days: number; steps_per_day: number | null; heart_pts: number };
  vitals: Record<'hba1c' | 'weight' | 'blood_pressure', { value: number; value2: number | null; at: string; level?: string } | null>;
  medicines: Medicine[];
  adherence: MedicineOverview['adherence'];
  stress: string | null;
  made_at: string;
}

export const getMedicines = () => read<MedicineOverview>('/medicines', 'Medicines', (d, _at, waiting) => withMedicines(d, waiting, Date.now()));
export type MedicineInput = { name: string; dose?: string | null; times: string[]; note?: string | null };
export const addMedicine = (m: MedicineInput) => postJson<{ status: string }>('/medicines', m, 'Medicine');
export async function updateMedicine(id: number, m: MedicineInput) {
  const res = await fetch(`${BASE_URL}/api/v1/medicines/${id}`, {
    method: 'PUT',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(m),
  });
  if (!res.ok) throw new Error(`Medicine failed: ${await res.text()}`);
}
export const removeMedicine = (id: number) => remove(`/medicines/${id}`, 'Delete');
export const logMedicine = (id: number, day: string, time: string, status: 'taken' | 'skipped' | null) =>
  log('medicine', `/medicines/${id}/log`, { medicine_id: id, day, time, status }, `medicine ${id} ${day} ${time}`);

export const getReport = (days: number) => getJson<DoctorReport>(`/report?days=${days}`, 'Report');
export const exportMyData = () => getJson<Record<string, unknown>>('/export', 'Export');
export const deleteMyAccount = () => postJson<{ status: string }>('/delete-account', { confirm: 'DELETE' }, 'Delete account');

export const getFitness = () => read<Fitness>('/fitness', 'Fitness', todayOnly);
export const addVital = (kind: VitalKind, value: number, value2?: number) =>
  log('vital', '/vitals', { kind, value, value2 });

async function remove(path: string, what: string) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) throw new Error(`${what} failed: ${await res.text()}`);
}
export const deleteVital = (id: number) => remove(`/vitals/${id}`, 'Delete');
export const deleteActivity = (id: number) => remove(`/activity/${id}`, 'Delete');

/** Delete a reading, meal or insulin dose from today's list. */
export async function deleteEntry(e: TimelineEvent) {
  if (typeof e.id === 'string' && e.id.startsWith('local:')) {
    if (!(await removeWaiting(e.id.slice(6)))) throw new Error('It is uploading right now. Try again in a moment.');
    return;
  }
  if (e.id == null) throw new Error('This entry can’t be deleted.');
  await remove(`/entries/${e.type}/${e.id}`, 'Delete');
}


// ---------------------------------------------------------
// STRESS PATTERN (last 7 days) and its effect on this user's sugar
// ---------------------------------------------------------

export interface StressPattern {
  pattern: {
    status: "not_enough_checks" | "calm" | "some" | "ongoing";
    window_days: number;
    checks: number;
    stressed_checks: number;
    stressed_days: number;
    headline: string;
    summary: string;
  };
  effect: {
    status: "learning" | "raises" | "lowers" | "no_clear_effect";
    stressed_pairs: number;
    calm_pairs: number;
    min_pairs: number;
    difference_mg_dl: number | null;
    headline: string;
    summary: string;
  };
  advice: string[];
  disclaimer: string;
}

export async function getStressPattern(): Promise<StressPattern> {
  const res = await fetch(`${BASE_URL}/api/v1/stress-pattern`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Stress pattern failed: ${await res.text()}`);
  }
  return res.json();
}


export async function getVoiceHistory(
  limit = 10
) {

  const {
    data,
    error,
  } =
    await supabase.auth
      .getSession();


  if (error) {

    throw new Error(
      "Could not read authentication session."
    );

  }


  const token =
    data.session
      ?.access_token;


  if (!token) {

    throw new Error(
      "Not logged in."
    );

  }


  const response =
    await fetch(
      `${BASE_URL}/api/v1/voice-history?limit=${limit}`,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );


  if (!response.ok) {

    const text =
      await response.text();


    throw new Error(
      `Voice history failed (${response.status}): ${text}`
    );

  }


  return response.json();
}