import os
import gc
import math
import statistics

from pydub import AudioSegment
from pydub.silence import detect_nonsilent

import parselmouth
from parselmouth.praat import call

from datetime import datetime, timedelta, timezone

from core.config import get_settings
from core.db import get_db

# ffmpeg location comes from .env (FFMPEG_PATH / FFPROBE_PATH). When unset,
# pydub finds ffmpeg on PATH, which is the normal setup on servers.
_settings = get_settings()
if _settings.ffmpeg_path:
    AudioSegment.converter = _settings.ffmpeg_path
if _settings.ffprobe_path:
    AudioSegment.ffprobe = _settings.ffprobe_path

MIN_AUDIO_SECONDS = 4.0
MIN_VOICED_RATIO = 0.20
MIN_SPEECH_ACTIVITY_RATIO = 0.35

LIMITED_HNR_DB = 3.0
ACCEPTABLE_HNR_DB = 5.0
GOOD_HNR_DB = 10.0

LIMITED_VOICED_RATIO = 0.30
GOOD_VOICED_RATIO = 0.40

MAX_SEMITONE_DEVIATION_FROM_MEDIAN = 7.0
MAX_PITCH_OUTLIER_RATIO_FOR_ACCEPTABLE = 0.30
MAX_PITCH_OUTLIER_RATIO_FOR_GOOD = 0.15


def _is_valid_number(value) -> bool:
    try:
        return value is not None and math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower_index = int(math.floor(position))
    upper_index = int(math.ceil(position))
    if lower_index == upper_index:
        return ordered[lower_index]
    fraction = position - lower_index
    return ordered[lower_index] + (ordered[upper_index] - ordered[lower_index]) * fraction


def _convert_to_wav(input_path: str) -> str:
    wav_path = input_path.rsplit(".", 1)[0] + "_converted.wav"
    audio = AudioSegment.from_file(input_path).set_channels(1).set_frame_rate(16000)

    if len(audio) <= 0:
        raise ValueError("The recording is empty. Please record your voice again.")

    if audio.dBFS != float("-inf"):
        nonsilent_ranges = detect_nonsilent(
            audio,
            min_silence_len=250,
            silence_thresh=audio.dBFS - 18,
        )
    else:
        nonsilent_ranges = []

    if not nonsilent_ranges:
        raise ValueError(
            "No usable speech was detected. Please speak naturally in a quiet environment."
        )

    start_ms = max(0, nonsilent_ranges[0][0] - 150)
    end_ms = min(len(audio), nonsilent_ranges[-1][1] + 150)
    audio = audio[start_ms:end_ms]

    duration_seconds = len(audio) / 1000.0
    if duration_seconds < MIN_AUDIO_SECONDS:
        raise ValueError(
            "The recording is too short for a reliable acoustic sample. "
            f"Speak naturally for at least {int(MIN_AUDIO_SECONDS)} seconds."
        )

    if audio.dBFS != float("-inf"):
        gain = -20.0 - audio.dBFS
        gain = max(-8.0, min(8.0, gain))
        audio = audio.apply_gain(gain)

    audio.export(wav_path, format="wav")
    return wav_path


def _get_speech_activity(wav_path: str) -> dict:
    audio = AudioSegment.from_wav(wav_path)
    duration_ms = len(audio)

    if duration_ms <= 0 or audio.dBFS == float("-inf"):
        return {"speech_activity_ratio": 0.0, "pause_ratio": 1.0}

    ranges = detect_nonsilent(
        audio,
        min_silence_len=250,
        silence_thresh=audio.dBFS - 18,
    )
    speech_ms = sum(end - start for start, end in ranges)
    speech_activity_ratio = speech_ms / duration_ms
    pause_ratio = 1.0 - speech_activity_ratio

    return {
        "speech_activity_ratio": round(_clamp(speech_activity_ratio), 3),
        "pause_ratio": round(_clamp(pause_ratio), 3),
    }


def _get_energy_variation(wav_path: str) -> float:
    audio = AudioSegment.from_wav(wav_path)
    levels = []
    for start in range(0, len(audio), 100):
        chunk = audio[start:start + 100]
        if len(chunk) > 0 and chunk.dBFS != float("-inf"):
            levels.append(float(chunk.dBFS))
    if len(levels) < 2:
        return 0.0
    return round(statistics.pstdev(levels), 2)


def _filter_pitch_frames(voiced_frequencies: list[float]) -> dict:
    if not voiced_frequencies:
        return {"filtered": [], "median_f0": 0.0, "outlier_ratio": 1.0}

    median_f0 = statistics.median(voiced_frequencies)
    if median_f0 <= 0:
        return {"filtered": [], "median_f0": 0.0, "outlier_ratio": 1.0}

    filtered = []
    for frequency in voiced_frequencies:
        if frequency <= 0:
            continue
        semitone_difference = 12.0 * math.log2(frequency / median_f0)
        if abs(semitone_difference) <= MAX_SEMITONE_DEVIATION_FROM_MEDIAN:
            filtered.append(frequency)

    outlier_ratio = (
        (len(voiced_frequencies) - len(filtered)) / len(voiced_frequencies)
        if voiced_frequencies
        else 1.0
    )

    return {
        "filtered": filtered,
        "median_f0": median_f0,
        "outlier_ratio": outlier_ratio,
    }


def extract_acoustic_features(wav_path: str) -> dict:
    sound = parselmouth.Sound(wav_path)
    duration_seconds = float(sound.duration)

    pitch = sound.to_pitch(
        time_step=0.01,
        pitch_floor=70,
        pitch_ceiling=500,
    )
    frequencies = pitch.selected_array["frequency"]
    raw_voiced_frequencies = [float(value) for value in frequencies if value > 0]

    total_frames = len(frequencies)
    raw_voiced_frames = len(raw_voiced_frequencies)
    voiced_ratio = raw_voiced_frames / total_frames if total_frames > 0 else 0.0

    if not raw_voiced_frequencies:
        raise ValueError(
            "No stable voiced speech was detected. Please speak naturally and clearly."
        )

    filtered_info = _filter_pitch_frames(raw_voiced_frequencies)
    filtered_frequencies = filtered_info["filtered"]
    pitch_median = filtered_info["median_f0"]
    pitch_outlier_ratio = filtered_info["outlier_ratio"]

    if len(filtered_frequencies) < 5:
        filtered_frequencies = raw_voiced_frequencies

    f0_mean = statistics.mean(filtered_frequencies)
    q1 = _percentile(filtered_frequencies, 0.25)
    q3 = _percentile(filtered_frequencies, 0.75)
    f0_iqr = max(0.0, q3 - q1)
    robust_f0_std = f0_iqr / 1.349 if f0_iqr > 0 else 0.0
    robust_pitch_cv = robust_f0_std / pitch_median if pitch_median > 0 else 0.0

    activity = _get_speech_activity(wav_path)
    speech_activity_ratio = activity["speech_activity_ratio"]
    pause_ratio = activity["pause_ratio"]

    if duration_seconds < MIN_AUDIO_SECONDS:
        raise ValueError(
            "Please speak naturally for a few more seconds so GlycoVision has enough audio to analyze."
        )

    if voiced_ratio < MIN_VOICED_RATIO:
        raise ValueError(
            "Not enough clear voiced speech was detected. Try speaking naturally a little closer "
            "to the microphone in a quieter environment."
        )

    if speech_activity_ratio < MIN_SPEECH_ACTIVITY_RATIO:
        raise ValueError(
            "The recording contains too much silence. Please speak naturally for most of the recording."
        )

    harmonicity = sound.to_harmonicity_cc(
        time_step=0.01,
        minimum_pitch=70,
        silence_threshold=0.1,
        periods_per_window=1.0,
    )
    hnr_mean = call(harmonicity, "Get mean", 0, 0)
    if not _is_valid_number(hnr_mean):
        hnr_mean = 0.0

    jitter_local = 0.0
    shimmer_local = 0.0
    try:
        point_process = call(sound, "To PointProcess (periodic, cc)", 70, 500)
        raw_jitter = call(
            point_process,
            "Get jitter (local)",
            0,
            0,
            0.0001,
            0.02,
            1.3,
        ) * 100
        if _is_valid_number(raw_jitter):
            jitter_local = float(raw_jitter)

        raw_shimmer = call(
            [sound, point_process],
            "Get shimmer (local)",
            0,
            0,
            0.0001,
            0.02,
            1.3,
            1.6,
        ) * 100
        if _is_valid_number(raw_shimmer):
            shimmer_local = float(raw_shimmer)
    except Exception as error:
        print("[Voice] Jitter/shimmer descriptive extraction skipped:", error)

    energy_variation_db = _get_energy_variation(wav_path)

    print(
        "[Natural Voice Quality v3]",
        {
            "duration_seconds": round(duration_seconds, 2),
            "total_pitch_frames": total_frames,
            "raw_voiced_frames": raw_voiced_frames,
            "voiced_ratio": round(voiced_ratio, 3),
            "speech_activity_ratio": speech_activity_ratio,
            "f0_mean_filtered": round(f0_mean, 2),
            "f0_median": round(pitch_median, 2),
            "f0_iqr": round(f0_iqr, 2),
            "robust_f0_std": round(robust_f0_std, 2),
            "robust_pitch_cv": round(robust_pitch_cv, 3),
            "pitch_outlier_ratio": round(pitch_outlier_ratio, 3),
            "hnr": round(float(hnr_mean), 2),
            "energy_variation_db": energy_variation_db,
        },
    )

    return {
        "duration_seconds": round(duration_seconds, 2),
        "f0_mean": round(f0_mean, 1),
        "f0_std": round(robust_f0_std, 1),
        "f0_median": round(pitch_median, 1),
        "f0_iqr": round(f0_iqr, 1),
        "pitch_cv": round(robust_pitch_cv, 3),
        "pitch_outlier_ratio": round(pitch_outlier_ratio, 3),
        "jitter": round(jitter_local, 2),
        "shimmer": round(shimmer_local, 2),
        "hnr": round(float(hnr_mean), 2),
        "voiced_ratio": round(voiced_ratio, 2),
        "speech_activity_ratio": speech_activity_ratio,
        "pause_ratio": pause_ratio,
        "energy_variation_db": energy_variation_db,
    }


def compute_acoustic_score(
    pitch_cv: float,
    hnr: float,
    voiced_ratio: float,
    speech_activity_ratio: float,
) -> float:
    """
    Experimental natural-speech acoustic variability score.

    NOT a stress probability.
    NOT a diagnosis.
    NOT for insulin dosing.
    """

    if pitch_cv <= 0.08:
        pitch_component = 0.15
    elif pitch_cv <= 0.14:
        pitch_component = 0.30
    elif pitch_cv <= 0.22:
        pitch_component = 0.50
    elif pitch_cv <= 0.32:
        pitch_component = 0.70
    else:
        pitch_component = 0.90

    if hnr >= 20:
        hnr_component = 0.10
    elif hnr >= 15:
        hnr_component = 0.25
    elif hnr >= 10:
        hnr_component = 0.45
    elif hnr >= 5:
        hnr_component = 0.70
    else:
        hnr_component = 0.90

    if voiced_ratio >= 0.55:
        voiced_component = 0.15
    elif voiced_ratio >= 0.40:
        voiced_component = 0.30
    elif voiced_ratio >= 0.30:
        voiced_component = 0.50
    else:
        voiced_component = 0.75

    if speech_activity_ratio >= 0.75:
        activity_component = 0.15
    elif speech_activity_ratio >= 0.60:
        activity_component = 0.30
    elif speech_activity_ratio >= 0.45:
        activity_component = 0.50
    else:
        activity_component = 0.75

    score = (
        pitch_component * 0.35
        + hnr_component * 0.35
        + voiced_component * 0.15
        + activity_component * 0.15
    )

    return round(_clamp(score), 2)


def _classify_recording_quality(features: dict) -> str:
    voiced_ratio = features["voiced_ratio"]
    speech_activity_ratio = features["speech_activity_ratio"]
    duration = features["duration_seconds"]
    hnr = features["hnr"]
    pitch_outlier_ratio = features["pitch_outlier_ratio"]

    if (
        hnr < LIMITED_HNR_DB
        or voiced_ratio < LIMITED_VOICED_RATIO
        or pitch_outlier_ratio > MAX_PITCH_OUTLIER_RATIO_FOR_ACCEPTABLE
    ):
        return "limited"

    if (
        duration >= 7
        and voiced_ratio >= GOOD_VOICED_RATIO
        and speech_activity_ratio >= 0.65
        and hnr >= GOOD_HNR_DB
        and pitch_outlier_ratio <= MAX_PITCH_OUTLIER_RATIO_FOR_GOOD
    ):
        return "good"

    if (
        duration >= MIN_AUDIO_SECONDS
        and voiced_ratio >= MIN_VOICED_RATIO
        and speech_activity_ratio >= MIN_SPEECH_ACTIVITY_RATIO
        and hnr >= ACCEPTABLE_HNR_DB
        and pitch_outlier_ratio <= MAX_PITCH_OUTLIER_RATIO_FOR_ACCEPTABLE
    ):
        return "acceptable"

    return "limited"


def analyze_voice(input_path: str) -> dict:
    wav_path = _convert_to_wav(input_path)

    try:
        features = extract_acoustic_features(wav_path)
    finally:
        gc.collect()
        try:
            if os.path.exists(wav_path):
                os.remove(wav_path)
        except PermissionError:
            print(f"[stress_engine] Could not delete temporary WAV file: {wav_path}")

    quality = _classify_recording_quality(features)

    acoustic_score = compute_acoustic_score(
        pitch_cv=features["pitch_cv"],
        hnr=features["hnr"],
        voiced_ratio=features["voiced_ratio"],
        speech_activity_ratio=features["speech_activity_ratio"],
    )

    if quality == "limited":
        interpretation = (
            "This recording had limited acoustic reliability. Try again in a quieter place, "
            "keep the phone at a consistent distance, and speak naturally for 8–15 seconds."
        )
    elif acoustic_score < 0.35:
        interpretation = "Lower acoustic variability was observed in this voice sample."
    elif acoustic_score < 0.60:
        interpretation = "Moderate acoustic variability was observed in this voice sample."
    else:
        interpretation = "Higher acoustic variability was observed in this voice sample."

    return {
        "stress_score": acoustic_score,
        "acoustic_score": acoustic_score,
        "quality": quality,
        "f0_mean": features["f0_mean"],
        "f0_std": features["f0_std"],
        "jitter": features["jitter"],
        "shimmer": features["shimmer"],
        "hnr": features["hnr"],
        "voiced_ratio": features["voiced_ratio"],
        "interpretation": interpretation,
        "model_status": "experimental-natural-speech-v3",
        "disclaimer": (
            "Experimental natural-speech acoustic analysis only. This score describes acoustic "
            "variation in one recording; it is not a diagnosis or probability of stress and must "
            "not be used to determine or change insulin dosing."
        ),
    }


def log_stress_reading(user_id: str, result: dict):
    db = get_db()

    db.table("stress_logs").insert({
        "user_id": user_id,
        "stress_score": result["acoustic_score"],
        "acoustic_score": result["acoustic_score"],
        "f0_mean": result["f0_mean"],
        "f0_std": result["f0_std"],
        "jitter": result["jitter"],
        "shimmer": result["shimmer"],
        "hnr": result["hnr"],
        "voiced_ratio": result["voiced_ratio"],
        "quality": result["quality"],
        "model_status": result["model_status"],
    }).execute()


def get_voice_history(user_id: str, limit: int = 10) -> list[dict]:
    db = get_db()

    res = (
        db.table("stress_logs")
        .select(
            "id,stress_score,acoustic_score,f0_mean,f0_std,jitter,shimmer,hnr,"
            "voiced_ratio,quality,model_status,logged_at"
        )
        .eq("user_id", user_id)
        .order("logged_at", desc=True)
        .limit(limit)
        .execute()
    )

    return res.data or []


def get_recent_stress_score(
    user_id: str,
    max_age_minutes: float = 120,
) -> float | None:
    """
    Temporary compatibility function.

    IMPORTANT: this experimental acoustic value must NOT
    automatically modify insulin recommendations.
    """

    db = get_db()

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(minutes=max_age_minutes)
    ).isoformat()

    res = (
        db.table("stress_logs")
        .select("stress_score,quality,logged_at")
        .eq("user_id", user_id)
        .neq("quality", "limited")
        .gte("logged_at", cutoff)
        .order("logged_at", desc=True)
        .limit(1)
        .execute()
    )

    rows = res.data or []
    return rows[0]["stress_score"] if rows else None
