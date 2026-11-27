"""
Stress gauge: voice and heart rate together (model 2 on the whiteboard).

Heart rate counts as a stress sign only when the person was NOT moving:
a fast heart after walking is exercise, which lowers sugar, while a fast
heart at rest can be stress, which may raise it.

Like the voice check alone, this shapes advice and never changes a dose.
"""

from datetime import datetime, timezone

from services import health_data
from services.stress_context import get_stress_context

STILL_STEPS_15M = 100      # fewer steps than this in 15 minutes = at rest
HR_RAISED = 15             # beats above this person's resting rate
HR_HIGH = 25
VOICE_POINTS = {None: 0, "calm": 0, "possible": 1, "elevated": 2}
HEART_POINTS = {"raised": 1, "high": 2}


def heart_sign(hr, resting, steps_15m) -> tuple[str, str]:
    """(sign, reason); sign is unknown, moving, normal, raised or high."""
    if hr is None:
        return "unknown", "No recent heart rate."
    if resting is None:
        return "unknown", "Still learning your usual resting heart rate."
    if steps_15m is None:
        return "unknown", "No step data, so movement can't be ruled out."
    if steps_15m >= STILL_STEPS_15M:
        return "moving", "You were moving, so heart rate is not used for stress."
    above = hr - resting
    if above >= HR_HIGH:
        return "high", f"Heart rate is {round(above)} beats above your usual while resting."
    if above >= HR_RAISED:
        return "raised", f"Heart rate is {round(above)} beats above your usual while resting."
    return "normal", "Heart rate is close to your usual."


def fuse(voice_level: str | None, sign: str) -> tuple[str | None, str | None]:
    """(stress level, what it is based on)."""
    heart_known = sign in ("normal", "raised", "high")
    if voice_level is None and not heart_known:
        return None, None
    points = VOICE_POINTS[voice_level] + HEART_POINTS.get(sign, 0)
    if points >= 3 or (voice_level == "elevated" and not heart_known):
        level = "elevated"
    else:
        level = "possible" if points >= 1 else "calm"
    if voice_level and heart_known:
        return level, "voice and heart rate"
    return level, "voice" if voice_level else "heart rate"


def stress_gauge(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    voice_level = get_stress_context(user_id).get("level")
    wearable = health_data.wearable_features(user_id, now)
    hr = wearable["hr_15m"]
    resting = health_data.resting_heart_rate(user_id, now) if hr is not None else None
    sign, reason = heart_sign(hr, resting, wearable["steps_15m"])
    level, basis = fuse(voice_level, sign)
    return {
        "level": level,
        "basis": basis,
        "voice_level": voice_level,
        "heart_sign": sign,
        "heart_reason": reason,
        "heart_rate": round(hr) if hr is not None else None,
        "resting_heart_rate": round(resting) if resting is not None else None,
        "disclaimer": "Stress estimate only. It never changes an insulin dose.",
    }
