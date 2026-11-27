"""
Physical activity suggestions to help keep sugar in range.

Safety first, then ideas. Limits used:
* below 70: no activity, treat the low.
* below 100 for people on insulin: about 15 g of carbs first
  (American Diabetes Association, "Exercise and Type 1").
* above 250 for people on insulin: check ketones first; none if present
  (ADA; UCLA Health). Above 300: follow the care plan first.

Insulin and activity both lower sugar. When a dose is suggested or still
active, only gentle options are offered, with a reminder to recheck, and
the dose is never changed because of them.

Calories use standard MET values: kcal = MET x weight (kg) x hours.
"""

from services.fitness import human_minutes

LOW = 70
SNACK_BELOW = 100
KETONE_ABOVE = 250
HOLD_ABOVE = 300
ACTIVE_IOB = 1.0
LIKELY_LOW = 0.25

MET = {"walk_easy": 3.0, "walk_brisk": 4.3, "stretch": 2.3, "move_break": 2.5, "chair": 2.8, "breathe": 1.3}
TEXT = {
    "walk_easy": ("Easy walk", "Gentle"),
    "walk_brisk": ("Brisk walk", "Moderate"),
    "stretch": ("Stretching", "Gentle"),
    "move_break": ("Stand and move", "Gentle"),
    "chair": ("Sit-to-stand from a chair", "Gentle"),
    "breathe": ("Slow breathing", "Rest"),
}


def _option(key: str, minutes: int, why: str, weight_kg) -> dict:
    name, intensity = TEXT[key]
    kcal = round(MET[key] * float(weight_kg) * minutes / 60) if weight_kg else None
    return {"key": key, "name": name, "minutes": minutes, "intensity": intensity, "why": why, "kcal": kcal}


def _result(status, headline, why, options=(), safety=()):
    return {"status": status, "headline": headline, "why": why, "options": list(options), "safety": list(safety)}


def activity_plan(
    *, bg=None, on_insulin=True, change_60=None, low_probability=None, spike_probability=None,
    iob=0.0, dose_suggested=0.0, ate_recently=False, stress_level=None,
    steps_today=None, hour=12.0, age=None, weight_kg=None, recently_active=False,
    sitting_min=None,
) -> dict:
    """`bg` is a recent reading or None. `on_insulin` should be True when unknown."""
    if bg is not None and bg < LOW:
        return _result(
            "blocked", "No exercise now: treat the low first",
            "Your sugar is below 70. Take 15 g of fast sugar, rest, and check again in 15 minutes.",
        )
    if bg is not None and bg > HOLD_ABOVE:
        return _result(
            "blocked", "Wait before exercising",
            f"Your sugar is {round(bg)}. Follow your care plan, drink water and check ketones if you can. "
            "Get medical help if you feel sick, are vomiting or breathing fast.",
        )

    if bg is None and on_insulin:
        return _result(
            "need_reading", "Check your sugar first",
            "Log a reading so GlycoVision can suggest activity that is safe for you right now.",
        )

    night = hour >= 22 or hour < 6
    safety, options = [], []
    likely_low = low_probability is not None and low_probability >= LIKELY_LOW
    gentle_only = False
    status = "go"

    if on_insulin and bg is not None and (bg < SNACK_BELOW or likely_low):
        status, gentle_only = "caution", True
        safety.append("Have about 15 g of carbs first, then check your sugar again.")
    if on_insulin and bg is not None and bg > KETONE_ABOVE:
        status, gentle_only = "caution", True
        safety.append("Check ketones first. If you have ketones or feel unwell, don't exercise.")
    if on_insulin and (iob >= ACTIVE_IOB or dose_suggested > 0):
        gentle_only = True
        safety.append("Insulin is working and activity also lowers sugar. Keep it gentle and recheck after.")
    if on_insulin:
        safety.append("Carry fast sugar, and stop if you feel shaky or sweaty.")
    if age is not None and age >= 65:
        gentle_only = True
    if recently_active:
        gentle_only = True
        if on_insulin:
            safety.append("You were active recently. Sugar can keep dropping for hours, so check it again later.")
    safety.append("Stop for chest pain, dizziness or a foot wound, and ask your doctor before starting.")

    if on_insulin and change_60 is None:
        gentle_only = True       # the direction is unknown

    rising = (change_60 is not None and change_60 >= 20) or (
        spike_probability is not None and spike_probability >= 0.4)

    if stress_level in ("possible", "elevated"):
        options.append(_option("breathe", 5, "Slow breaths can ease stress, which can raise sugar.", None))

    if night:
        options.append(_option("stretch", 10, "Gentle at night, so your sugar doesn't drop while you sleep.", weight_kg))
        headline, why = "Keep it light tonight", "It's late, so a few minutes of easy stretching is enough."
    elif likely_low and on_insulin:
        options.append(_option("stretch", 5, "Light movement only until your sugar is steady.", weight_kg))
        headline, why = "Be careful: your sugar may drop", "Wait for a steady reading before a walk."
    elif rising or ate_recently:
        key = "walk_easy" if gentle_only else "walk_brisk"
        options.append(_option(key, 10 if recently_active else 15, "Walking helps your muscles use the sugar from your meal.", weight_kg))
        options.append(_option("chair", 5, "Good indoors if you can't go out: 5 minutes, at your pace.", weight_kg))
        headline = "Walk to soften the rise"
        why = "Moving soon after eating lowers the rise more than moving before the meal."
    else:
        key = "walk_easy" if gentle_only or bg is None else "walk_brisk"
        options.append(_option(key, 10, "A short walk helps keep your sugar steady.", weight_kg))
        options.append(_option("stretch", 5, "Loosens stiff muscles and is easy to do anywhere.", weight_kg))
        headline = "A little movement helps"
        why = ("Your sugar looks steady. Short, regular activity keeps it that way."
               if change_60 is not None else "Short, regular activity helps keep your sugar steady.")

    few_steps = steps_today is not None and steps_today < 3000 and hour >= 12
    if not night and not (likely_low and on_insulin) and (few_steps or (sitting_min or 0) >= 60):
        why_move = (f"You've been still for {human_minutes(sitting_min)}. Stand and move every 30 minutes."
                    if (sitting_min or 0) >= 60 else "Few steps today: stand and move every 30 minutes.")
        options.append(_option("move_break", 3, why_move, weight_kg))

    return _result(status, headline, why, options[:3], safety)
