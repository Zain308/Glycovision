import { supabase } from "@/lib/supabase";
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
// POSTs are never retried, so nothing is logged twice.

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const isUpload = typeof FormData !== "undefined" && init.body instanceof FormData;
  const timeoutMs = isUpload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const attempts = method === "GET" ? 2 : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await globalThis.fetch(input, { ...init, signal: init.signal ?? controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 800));
    } finally {
      clearTimeout(timer);
    }
  }

  const aborted = (lastError as { name?: string })?.name === "AbortError";
  throw new Error(
    aborted
      ? "The server took too long to answer. Check your internet and try again."
      : "Couldn't reach GlycoVision. Check your internet connection and try again.",
  );
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

  created_at?: string;
  updated_at?: string;
}


export interface ProfileUpdate {
  full_name?: string;
  diabetes_type?: string;

  icr?: number;
  isf?: number;
  target_bg?: number;
  dia_hours?: number;
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

async function authHeaders() {
  const { data, error } =
    await supabase.auth.getSession();

  if (error) {
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

export async function getDashboardSummary() {
  const res = await fetch(
    `${BASE_URL}/api/v1/dashboard-summary`,
    {
      headers:
        await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Dashboard fetch failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// MEAL LOGGING
// ---------------------------------------------------------

export async function logMeal(
  meal: MealLogPayload
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/log-meal`,
    {
      method: "POST",

      headers: {
        ...(await authHeaders()),
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(
        meal
      ),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Log meal failed: ${await res.text()}`
    );
  }

  return res.json();
}


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
  type: "meal" | "insulin" | "bg";
  title: string;
  detail: string;
  value?: number;
  logged_at: string;
}

export async function getTimelineToday(): Promise<TimelineEvent[]> {
  const res = await fetch(`${BASE_URL}/api/v1/timeline-today`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Timeline failed: ${await res.text()}`);
  }
  return (await res.json()).events ?? [];
}


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

export async function getFoodLibrary(): Promise<LibraryFood[]> {
  const res = await fetch(`${BASE_URL}/api/v1/foods`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Food library failed: ${await res.text()}`);
  }
  return (await res.json()).foods;
}


// ---------------------------------------------------------
// PROFILE
// ---------------------------------------------------------

export async function getProfile(): Promise<Profile> {
  const res = await fetch(
    `${BASE_URL}/api/v1/profile`,
    {
      headers:
        await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Profile fetch failed: ${await res.text()}`
    );
  }

  return res.json();
}


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

export async function logBolus(
  payload: BolusLogPayload
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/log-bolus`,
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
      `Log bolus failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// BLOOD GLUCOSE
// ---------------------------------------------------------

export async function logBg(
  value: number
) {
  const res = await fetch(
    `${BASE_URL}/api/v1/log-bg`,
    {
      method: "POST",

      headers: {
        ...(await authHeaders()),
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        value,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Log BG failed: ${await res.text()}`
    );
  }

  return res.json();
}


export async function getBgHistory(
  hours: number = 24
): Promise<BgHistoryResponse> {
  const res = await fetch(
    `${BASE_URL}/api/v1/bg-history?hours=${hours}`,
    {
      headers:
        await authHeaders(),
    }
  );

  if (!res.ok) {
    throw new Error(
      `BG history fetch failed: ${await res.text()}`
    );
  }

  return res.json();
}


// ---------------------------------------------------------
// INSULIN ON BOARD
// ---------------------------------------------------------

export async function getCurrentIob() {
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