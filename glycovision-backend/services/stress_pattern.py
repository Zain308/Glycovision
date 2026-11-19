"""
Stress over time, and what stress does to this patient's own sugar.

Two questions, both answered from the patient's own logs:

1. Is the stress ongoing?  Looks at reliable voice checks from the last
   7 days. Stress on 3 or more different days, in at least half of the
   checks, counts as ongoing.

2. What does stress do to *my* sugar?  For each reliable voice check in
   the last 30 days, takes the reading just before the check and the
   highest reading 1 to 3 hours after it. Checks with a meal or an
   insulin dose in that window are skipped, because food and insulin
   would hide the effect of stress. Compares the average rise after
   stressed checks with the average rise after calm ones.

Safety: neither result changes an insulin dose. Stress raises sugar in
many people and lowers it in some, and the voice score is not a
validated stress test. A higher reading is already covered by the
normal correction dose, which follows the measured sugar. These results
help the patient and their doctor decide on a plan.
"""

from datetime import datetime, timedelta, timezone
from statistics import mean

from core.db import get_db
from services.stress_context import RELIABLE_QUALITIES, _level_from, _parse_time
from services.voice_baseline import get_saved_baseline
from services.voice_deviation import compare_to_personal_baseline

PATTERN_DAYS = 7
EFFECT_DAYS = 30

ONGOING_MIN_DAYS = 3          # stressed on at least 3 different days
ONGOING_MIN_SHARE = 0.5       # and in at least half of the checks
MIN_CHECKS_FOR_PATTERN = 3

BEFORE_WINDOW = (-30, 10)     # minutes around the check for the "before" reading
AFTER_WINDOW = (60, 180)      # minutes after the check for the "after" peak
MIN_PAIRS_PER_GROUP = 3       # stressed and calm pairs needed for an effect
NOTABLE_EFFECT_MG_DL = 20     # smaller differences are treated as no clear effect

STRESSED_LEVELS = ("possible", "elevated")


def _rows(table: str, user_id: str, since: datetime, columns: str) -> list[dict]:
    res = (
        get_db()
        .table(table)
        .select(columns)
        .eq("user_id", user_id)
        .gte("logged_at", since.isoformat())
        .order("logged_at", desc=False)
        .execute()
    )
    out = []
    for r in res.data or []:
        try:
            r = {**r, "_t": _parse_time(r["logged_at"])}
        except (KeyError, TypeError, ValueError):
            continue
        out.append(r)
    return out


def classified_checks(user_id: str, since: datetime) -> list[dict]:
    """Reliable voice checks since `since`, each with its stress level."""
    checks = [
        c
        for c in _rows(
            "stress_logs",
            user_id,
            since,
            "acoustic_score,stress_score,f0_mean,f0_std,hnr,voiced_ratio,"
            "quality,model_status,logged_at",
        )
        if c.get("quality") in RELIABLE_QUALITIES
    ]
    if not checks:
        return []

    try:
        baseline = get_saved_baseline(user_id=user_id)
    except Exception as error:
        print("[Stress pattern] Baseline unavailable:", repr(error))
        baseline = None

    out = []
    for c in checks:
        try:
            comparison = compare_to_personal_baseline(
                user_id=user_id, voice_result=c, baseline_record=baseline
            )
        except Exception:
            comparison = None
        level, basis = _level_from(c, comparison)
        out.append({"time": c["_t"], "level": level, "basis": basis})
    return out


# ---------------------------------------------------------------- pattern

def summarise_pattern(checks: list[dict], now: datetime) -> dict:
    """Pure function: ongoing / some / calm from classified checks."""
    recent = [c for c in checks if c["time"] >= now - timedelta(days=PATTERN_DAYS)]
    stressed = [c for c in recent if c["level"] in STRESSED_LEVELS]
    stressed_days = sorted({c["time"].date().isoformat() for c in stressed})
    total = len(recent)
    share = (len(stressed) / total) if total else 0.0

    base = {
        "window_days": PATTERN_DAYS,
        "checks": total,
        "stressed_checks": len(stressed),
        "stressed_days": len(stressed_days),
        "stressed_share": round(share, 2),
    }

    if total < MIN_CHECKS_FOR_PATTERN:
        return {
            **base,
            "status": "not_enough_checks",
            "headline": "Not enough voice checks yet",
            "summary": (
                f"Do at least {MIN_CHECKS_FOR_PATTERN} voice checks this week "
                "to see your stress pattern."
            ),
        }

    if len(stressed_days) >= ONGOING_MIN_DAYS and share >= ONGOING_MIN_SHARE:
        return {
            **base,
            "status": "ongoing",
            "headline": "Stress has been ongoing this week",
            "summary": (
                f"Your voice suggested stress on {len(stressed_days)} of the last "
                f"{PATTERN_DAYS} days ({len(stressed)} of {total} checks). Ongoing "
                "stress can keep blood sugar higher than usual."
            ),
        }

    if stressed:
        return {
            **base,
            "status": "some",
            "headline": "Some stress this week",
            "summary": (
                f"{len(stressed)} of your {total} voice checks this week suggested stress."
            ),
        }

    return {
        **base,
        "status": "calm",
        "headline": "Calm week",
        "summary": f"None of your {total} voice checks this week suggested stress.",
    }


# ---------------------------------------------------------------- effect on sugar

def _in_window(rows: list[dict], t: datetime, lo: int, hi: int) -> list[dict]:
    a, b = t + timedelta(minutes=lo), t + timedelta(minutes=hi)
    return [r for r in rows if a <= r["_t"] <= b]


def glucose_rise_after(check_time: datetime, readings, meals, doses) -> float | None:
    """Rise in mg/dL 1 to 3 h after a check, or None if it can't be measured cleanly."""
    lo, hi = BEFORE_WINDOW[0], AFTER_WINDOW[1]
    if _in_window(meals, check_time, lo, hi) or _in_window(doses, check_time, lo, hi):
        return None

    before = _in_window(readings, check_time, *BEFORE_WINDOW)
    after = _in_window(readings, check_time, *AFTER_WINDOW)
    if not before or not after:
        return None

    nearest = min(before, key=lambda r: abs((r["_t"] - check_time).total_seconds()))
    try:
        start = float(nearest["value"])
        peak = max(float(r["value"]) for r in after)
    except (TypeError, ValueError):
        return None
    if start <= 0 or peak <= 0:
        return None
    return peak - start


def summarise_effect(pairs: list[tuple[str, float]]) -> dict:
    """Pure function: compare rises after stressed vs calm checks."""
    stressed = [r for lvl, r in pairs if lvl in STRESSED_LEVELS]
    calm = [r for lvl, r in pairs if lvl == "calm"]

    base = {
        "window_days": EFFECT_DAYS,
        "stressed_pairs": len(stressed),
        "calm_pairs": len(calm),
        "min_pairs": MIN_PAIRS_PER_GROUP,
    }

    if len(stressed) < MIN_PAIRS_PER_GROUP or len(calm) < MIN_PAIRS_PER_GROUP:
        return {
            **base,
            "status": "learning",
            "difference_mg_dl": None,
            "headline": "Still learning how stress affects your sugar",
            "summary": (
                "Log a sugar reading when you do a voice check, and again 1 to 3 hours "
                f"later without eating or taking insulin in between. GlycoVision needs "
                f"{MIN_PAIRS_PER_GROUP} stressed and {MIN_PAIRS_PER_GROUP} calm examples "
                f"(you have {len(stressed)} and {len(calm)})."
            ),
        }

    s_avg, c_avg = mean(stressed), mean(calm)
    diff = round(s_avg - c_avg)
    out = {
        **base,
        "stressed_avg_rise_mg_dl": round(s_avg),
        "calm_avg_rise_mg_dl": round(c_avg),
        "difference_mg_dl": diff,
    }

    if diff >= NOTABLE_EFFECT_MG_DL:
        return {
            **out,
            "status": "raises",
            "headline": "Stress seems to raise your sugar",
            "summary": (
                f"After stressed voice checks your sugar rose about {diff} mg/dL more "
                "over the next 1 to 3 hours than after calm ones. Show this to your "
                "doctor; they can decide whether you need a stress plan."
            ),
        }
    if diff <= -NOTABLE_EFFECT_MG_DL:
        return {
            **out,
            "status": "lowers",
            "headline": "Stress seems to lower your sugar",
            "summary": (
                f"After stressed voice checks your sugar was about {abs(diff)} mg/dL "
                "lower than after calm ones. Watch for lows when you are stressed, "
                "and tell your doctor."
            ),
        }
    return {
        **out,
        "status": "no_clear_effect",
        "headline": "No clear effect of stress on your sugar",
        "summary": (
            "So far your sugar changes about the same after stressed and calm voice "
            "checks. Keep checking as usual."
        ),
    }


def get_stress_pattern(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=EFFECT_DAYS)

    checks = classified_checks(user_id, since)
    pattern = summarise_pattern(checks, now)

    readings = _rows("bg_readings", user_id, since - timedelta(hours=1), "value,logged_at")
    meals = _rows("meals", user_id, since - timedelta(hours=1), "logged_at")
    doses = _rows("bolus_logs", user_id, since - timedelta(hours=1), "logged_at")

    pairs = []
    for c in checks:
        rise = glucose_rise_after(c["time"], readings, meals, doses)
        if rise is not None:
            pairs.append((c["level"], rise))
    effect = summarise_effect(pairs)

    return {
        "pattern": pattern,
        "effect": effect,
        "advice": build_advice(pattern, effect),
        "disclaimer": (
            "Experimental. Based on your own voice checks and readings. "
            "It never changes an insulin dose."
        ),
    }


def build_advice(pattern: dict, effect: dict) -> list[str]:
    tips = []
    if pattern["status"] == "ongoing":
        tips += [
            "Check your sugar more often while stress lasts, for example every 3 to 4 hours.",
            "If your sugar is high, the normal correction already covers it. Do not add extra units on your own.",
            "Wait at least 2 to 3 hours between corrections, so insulin does not stack.",
            "Book a talk with your doctor about a plan for stressful periods.",
        ]
    if effect["status"] == "raises":
        tips.append("Show your doctor this stress report. Only they should change your ratios for stressful days.")
    elif effect["status"] == "lowers":
        tips.append("Keep fast sugar with you on stressful days, and check before driving.")
    if pattern["status"] in ("ongoing", "some"):
        tips.append("Sleep, a short walk and slow breathing lower stress hormones.")
    return tips
