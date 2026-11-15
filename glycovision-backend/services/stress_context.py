"""
Stress context from recent voice checks.

Turns the latest reliable voice check into a simple stress signal and
practical advice, so the voice feature connects to the rest of the app
(Bolus, Dashboard, spike guidance).

Safety design: the stress signal changes the ADVICE shown around a dose,
never the dose itself. The voice score measures acoustic variation, not
validated stress, and there is no validated mapping from it to insulin
units. Stress hormones can raise blood glucose for a few hours, so the
sensible response is to monitor more closely and avoid stacking
corrections, which is what the guidance below says.
"""

from datetime import datetime, timedelta, timezone

from core.db import get_db
from services.voice_deviation import compare_to_personal_baseline

# A voice check older than this no longer describes the user's state.
MAX_AGE_MINUTES = 180

# Without a personal baseline, only a high single-recording score counts,
# and only as "possible" stress.
SINGLE_RECORDING_POSSIBLE_THRESHOLD = 0.60

RELIABLE_QUALITIES = ("good", "acceptable")

LEVELS = ("calm", "possible", "elevated")


def _parse_time(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _latest_reliable_check(user_id: str, now: datetime) -> dict | None:
    cutoff = (now - timedelta(minutes=MAX_AGE_MINUTES)).isoformat()
    res = (
        get_db()
        .table("stress_logs")
        .select(
            "acoustic_score,stress_score,f0_mean,f0_std,hnr,voiced_ratio,"
            "quality,model_status,logged_at"
        )
        .eq("user_id", user_id)
        .in_("quality", list(RELIABLE_QUALITIES))
        .gte("logged_at", cutoff)
        .order("logged_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _level_from(check: dict, comparison: dict | None) -> tuple[str, str]:
    """(level, basis) for one voice check."""
    if comparison and comparison.get("comparison_ready"):
        pattern = comparison.get("pattern")
        if pattern == "different":
            return "elevated", "personal_baseline"
        if pattern == "mildly_different":
            return "possible", "personal_baseline"
        return "calm", "personal_baseline"

    score = check.get("acoustic_score")
    if score is None:
        score = check.get("stress_score")
    try:
        score = float(score)
    except (TypeError, ValueError):
        score = 0.0

    if score >= SINGLE_RECORDING_POSSIBLE_THRESHOLD:
        return "possible", "single_recording"
    return "calm", "single_recording"


def _advice(level: str, basis: str) -> dict:
    if level == "elevated":
        headline = "Your voice suggests you may be stressed"
    elif level == "possible":
        headline = "Your voice suggests possible stress"
    else:
        headline = "Your voice sounds like your usual self"

    if level == "calm":
        return {
            "headline": headline,
            "summary": "No sign of stress in your latest voice check. Keep to your usual routine.",
            "suggestions": [
                "Keep checking your blood sugar as usual.",
            ],
            "bolus_note": None,
        }

    summary = (
        "Stress hormones such as cortisol and adrenaline can raise blood sugar "
        "for a few hours, even without food."
    )
    if basis == "single_recording":
        summary += (
            " This is based on one recording. After a few more voice checks, "
            "GlycoVision compares each one with your usual voice, which is more reliable."
        )

    return {
        "headline": headline,
        "summary": summary,
        "suggestions": [
            "Check your blood sugar now.",
            "Check again in 1 to 2 hours, because stress can make it rise slowly.",
            "If it's high, recheck before taking an extra correction, so insulin doesn't stack.",
            "Drink water, and take a few minutes of slow breathing or a short break if you can.",
            "If your readings stay high, follow the plan agreed with your diabetes care team.",
        ],
        "bolus_note": (
            "A recent voice check suggests stress, which can raise blood sugar for a "
            "few hours. This estimate is not changed by it. Recheck your blood sugar "
            "in 1 to 2 hours before taking any extra correction."
        ),
    }


def get_stress_context(
    user_id: str,
    comparison: dict | None = None,
) -> dict:
    """
    The current stress context for a user.

    `comparison` can pass in a personal-baseline comparison that was just
    calculated (right after a voice check) to avoid recomputing it.
    """
    now = datetime.now(timezone.utc)
    check = _latest_reliable_check(user_id, now)

    if check is None:
        return {
            "status": "no_recent_check",
            "level": None,
            "headline": "No recent voice check",
            "summary": (
                f"Do a voice check to add stress context. Checks older than "
                f"{MAX_AGE_MINUTES // 60} hours are not used."
            ),
            "suggestions": [],
            "bolus_note": None,
        }

    if comparison is None:
        try:
            comparison = compare_to_personal_baseline(
                user_id=user_id,
                voice_result=check,
            )
        except Exception as error:
            print("[Stress context] Baseline comparison failed:", repr(error))
            comparison = None

    level, basis = _level_from(check, comparison)
    checked_at = _parse_time(check["logged_at"])
    age_minutes = max(0, round((now - checked_at).total_seconds() / 60))

    return {
        "status": "recent",
        "level": level,
        "basis": basis,
        "checked_at": checked_at.isoformat(),
        "age_minutes": age_minutes,
        **_advice(level, basis),
        "disclaimer": (
            "Experimental voice analysis. It adds context to advice and never "
            "changes an insulin dose."
        ),
    }
