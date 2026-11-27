"""
The supervisor's flow in one place:

    1. forecast  - the next 60 minutes: direction, size, range
    2. insulin   - only for people prescribed rapid-acting mealtime insulin:
                   formula dose, tested on the insulin curve
    3. activity  - for everyone, aware of the dose and active insulin

`inputs` and `links` say how each input reaches each output (plan_links).
Stress can move the forecast, only by this patient's own measured effect.
It never changes the dose.
"""

from datetime import datetime, timedelta, timezone

from core.db import get_db
from core.user_time import get_profile_row, local_day_start_utc_iso, user_timezone
from models.schemas import PatientState
from services import health_data
from services.activity_advice import activity_plan
from services.body_metrics import age_from, body_metrics
from services.bolus_engine import calculate_safe_bolus
from services.dose_simulator import CARB_MINUTES, INSULIN_INFO, SAFE_MIN, SAFE_MIN_ACTIVE, check_dose
from services.glucose_forecast import forecast_from_context, load_context
from services.iob_engine import effective_dia_hours, iob_fraction_remaining
from services.plan_links import build_inputs, build_links, recheck_minutes
from services.stress_fusion import stress_gauge
from services.stress_pattern import get_stress_pattern

UNCOVERED_MEAL_MIN = 60       # a meal older than this is no longer dosed for
DOSE_BEFORE_MEAL_MIN = 30     # a dose this soon before a meal covers it
MIN_DOSE = 0.5                # smaller than most pens can give
NO_DIABETES = "No diabetes"
ACTIVE_MINUTES = 20           # this much in 2 hours counts as recently active
STEPS_PER_MINUTE = 100        # a common rule for moderate walking
STRESS_LIMIT = 30             # mg/dL, most that stress may move the forecast
DISCLAIMER = (
    "This is an estimate from a student research app, not a prescription. It uses no medical "
    "hardware and can be wrong. Follow your doctor's plan and check before you inject."
)


def uncovered_meal(meals: list[dict], doses: list[dict], now: datetime) -> dict | None:
    """The latest meal of the last hour with no dose around or after it."""
    recent = [m for m in meals if timedelta(0) <= now - m["_t"] <= timedelta(minutes=UNCOVERED_MEAL_MIN)]
    if not recent:
        return None
    meal = max(recent, key=lambda m: m["_t"])
    covered = any(d["_t"] >= meal["_t"] - timedelta(minutes=DOSE_BEFORE_MEAL_MIN) for d in doses)
    return None if covered or not meal.get("carbs") else meal


def recent_activity_minutes(today: dict, wearable: dict, now: datetime) -> int:
    """Minutes moved in the last 2 hours: typed in, or walked in the last hour."""
    since = now - timedelta(hours=2)
    typed = 0
    for row in today.get("manual") or []:
        try:
            if since <= health_data.parse_time(row["logged_at"]) <= now:
                typed += int(row["minutes"])
        except (KeyError, TypeError, ValueError):
            continue
    walked = round((wearable.get("steps_60m") or 0) / STEPS_PER_MINUTE)
    return max(typed, walked)      # not added: a typed walk is also counted as steps


def stress_shift(user_id: str, level: str | None) -> float:
    """
    How much stress moves this patient's next hour, from their own checks.
    0 unless they are stressed now AND their own data shows a clear effect.
    The measured effect is a peak 1 to 3 hours later, so half is used for
    the first hour. It is added to the forecast only, never to a dose.
    """
    if level not in ("possible", "elevated"):
        return 0.0
    try:
        effect = get_stress_pattern(user_id)["effect"]
    except Exception as error:
        print("[Care plan] Stress effect unavailable:", repr(error)[:200])
        return 0.0
    if effect.get("status") not in ("raises", "lowers"):
        return 0.0
    return max(-STRESS_LIMIT, min(STRESS_LIMIT, effect["difference_mg_dl"] / 2))


def weight_check(isf, weight) -> str | None:
    """
    Warn (never change anything) when the sensitivity number doesn't fit the
    body weight. Daily insulin is typically 0.4 to 1.0 units per kg (ADA
    Standards of Care), and sensitivity is about 1800 / daily dose; a factor
    of two on each side is allowed before warning.
    """
    if not isf or not weight:
        return None
    low, high = 1800 / float(weight) / 2, 1800 / (0.4 * float(weight)) * 2
    if low <= float(isf) <= high:
        return None
    return f"Your sensitivity ({float(isf):g}) looks unusual for your weight. Please check it with your doctor."


def insulin_plan(
    profile: dict, forecast: dict, ctx: dict, now: datetime, carbs: float | None = None, recently_active: bool = False,
) -> dict:
    takes = profile.get("mealtime_insulin")
    if takes is False or profile.get("diabetes_type") == NO_DIABETES:
        return {"status": "not_needed", "message": "Insulin is skipped because you don't take mealtime insulin."}
    kind = profile.get("insulin_type")
    if takes is None or not kind:
        return {"status": "setup", "message": "Tell us in Profile if a doctor prescribed you mealtime insulin, and which type."}
    info = INSULIN_INFO.get(kind, INSULIN_INFO["other"])
    if not info["supported"]:
        return {"status": "unsupported", "insulin": info["name"],
                "message": f"GlycoVision can't estimate doses for {info['name'].lower()}. Follow your doctor's dose."}
    if any(not profile.get(k) for k in ("icr", "isf", "target_bg")):
        return {"status": "setup", "message": "Add your carb ratio, sensitivity and target sugar in Profile."}
    if forecast["status"] != "ready":
        return {"status": "need_reading", "message": forecast["message"]}

    bg = float(forecast["current_bg"])
    if bg < 70:
        return {"status": "blocked_low", "units": 0.0, "message": "No insulin now. Treat the low first, then check again in 15 minutes."}

    icr, isf, target = float(profile["icr"]), float(profile["isf"]), float(profile["target_bg"])
    dia = effective_dia_hours(profile.get("dia_hours"))
    ago = lambda row: (now - row["_t"]).total_seconds() / 60
    doses = [(float(d["dose_units"] or 0), ago(d)) for d in ctx["doses"] if 0 <= ago(d) < dia * 60]
    iob = round(sum(u * iob_fraction_remaining(a, dia * 60) for u, a in doses), 2)
    meals = [(float(m["carbs"] or 0), ago(m)) for m in ctx["meals"] if 0 <= ago(m) < CARB_MINUTES]

    meal = uncovered_meal(ctx["meals"], ctx["doses"], now)
    meal_name = meal["food_name"] if meal and carbs is None else None
    if carbs is not None:
        meals.append((carbs, 0.0))       # about to be eaten, not logged yet
    carbs = (carbs or 0.0) + (float(meal["carbs"]) if meal else 0.0)

    try:
        formula = calculate_safe_bolus(PatientState(
            current_bg=bg, target_bg=target, isf=isf, iob=min(iob, 50), total_carbs=carbs, icr=icr))
    except ValueError:
        return {"status": "setup", "message": "One of your Profile numbers is outside the safe range. Please check it."}

    units = formula.recommended_total_dose_units
    # A correction on top of a likely low would be dangerous.
    if carbs == 0 and forecast["low_probability"] >= 0.2 and units > 0:
        return {"status": "hold", "units": 0.0, "formula_units": units, "iob": iob,
                "message": "A correction is held back because your sugar may drop soon. Check again in 30 minutes."}

    test = check_dose(units, bg, isf, icr, dia, doses, meals, SAFE_MIN_ACTIVE if recently_active else SAFE_MIN)
    base = {
        "weight_check": weight_check(isf, profile.get("weight_kg")),
        "iob": iob, "carbs": round(carbs, 1), "meal_name": meal_name, "dia_hours": dia,
        "breakdown": formula.breakdown.model_dump(), "flags": formula.safety_flags, "test": test,
        "insulin": info["name"], "disclaimer": formula.disclaimer,
    }
    if 0 < test["units"] < MIN_DOSE:
        return {**base, "status": "none_needed", "units": 0.0,
                "message": "Any extra insulin would be less than half a unit, so none is suggested."}
    if test["units"] <= 0:
        why = ("Active insulin already covers it." if iob > 0 else "No extra insulin is needed right now.")
        return {**base, "status": "none_needed", "units": 0.0, "message": why}
    message = (
        f"{test['units']} units: starts working in about {info['starts']}, strongest after {info['strongest']}, "
        f"and lasts about {dia:g} hours."
    )
    if test["lowered"]:
        message += f" Lowered from {test['formula_units']} so your sugar doesn't drop too far."
    return {**base, "status": "dose", "units": test["units"], "starts": info["starts"],
            "strongest": info["strongest"], "message": message}


def test_calculator_dose(user_id: str, state: PatientState, result) -> None:
    """Apply the profile and insulin-curve checks to the Bolus screen's result."""
    profile = get_profile_row(get_db(), user_id) or {}
    if profile.get("mealtime_insulin") is False or profile.get("diabetes_type") == NO_DIABETES:
        result.recommended_total_dose_units = 0.0
        result.safety_flags.append("Your profile says you don't take mealtime insulin, so no dose is shown.")
        return
    kind = profile.get("insulin_type")
    if kind and not INSULIN_INFO.get(kind, INSULIN_INFO["other"])["supported"]:
        result.recommended_total_dose_units = 0.0
        result.safety_flags.append("This estimate only fits rapid-acting insulin. Follow your doctor's dose.")
        return
    if result.recommended_total_dose_units <= 0:
        return

    now = datetime.now(timezone.utc)
    ctx = load_context(user_id, now, profile)
    dia = effective_dia_hours(profile.get("dia_hours"))
    ago = lambda row: (now - row["_t"]).total_seconds() / 60
    doses = [(float(d["dose_units"] or 0), ago(d)) for d in ctx["doses"] if 0 <= ago(d) < dia * 60]
    # The meal being dosed may already be logged: skip very recent meals so
    # its carbs aren't counted twice.
    meals = [(float(m["carbs"] or 0), ago(m)) for m in ctx["meals"] if 30 <= ago(m) < CARB_MINUTES]
    if state.total_carbs > 0:
        meals.append((state.total_carbs, 0.0))
    active = recent_activity_minutes({"manual": health_data.manual_activity(user_id, now - timedelta(hours=2))},
                                     ctx.get("wearable") or {}, now) >= ACTIVE_MINUTES
    test = check_dose(result.recommended_total_dose_units, state.current_bg, state.isf, state.icr, dia, doses, meals,
                      SAFE_MIN_ACTIVE if active else SAFE_MIN)
    if test["lowered"]:
        result.recommended_total_dose_units = test["units"]
        result.safety_flags.append(
            f"Lowered from {test['formula_units']} u: the full dose could drop your sugar too far.")
    result.dose_test = test


def build_care_plan(user_id: str, carbs: float | None = None) -> dict:
    now = datetime.now(timezone.utc)
    db = get_db()
    profile = get_profile_row(db, user_id) or {}
    ctx = load_context(user_id, now, profile)

    day_start = health_data.parse_time(local_day_start_utc_iso(user_timezone(profile)))
    today = health_data.today_summary(user_id, day_start)
    try:
        stress = stress_gauge(user_id)
    except Exception as error:
        print("[Care plan] Stress unavailable:", repr(error)[:200])
        stress = None
    level = (stress or {}).get("level")
    shift = stress_shift(user_id, level)
    active_minutes = recent_activity_minutes(today, ctx["wearable"], now)
    active = active_minutes >= ACTIVE_MINUTES

    forecast = forecast_from_context(ctx, now, carbs or 0.0, profile, shift)
    insulin = insulin_plan(profile, forecast, ctx, now, carbs, active)

    ready = forecast["status"] == "ready"
    iob = sum(
        float(d["dose_units"] or 0) * iob_fraction_remaining((now - d["_t"]).total_seconds() / 60, 240)
        for d in ctx["doses"] if d["_t"] <= now
    )
    ate = carbs is not None or any(now - m["_t"] <= timedelta(minutes=90) for m in ctx["meals"])
    # One reading has no trend: unknown, not "steady".
    trend_known = ready and not str(forecast["based_on"]).startswith("single")
    activity = activity_plan(
        bg=forecast["current_bg"] if ready else None,
        # Background insulin and some tablets cause lows too, so everyone with
        # diabetes gets the careful limits, not only mealtime-insulin users.
        on_insulin=profile.get("diabetes_type") != NO_DIABETES,
        change_60=forecast["change_60"] if trend_known else None, low_probability=forecast.get("low_probability"),
        spike_probability=forecast.get("spike_probability"), iob=iob,
        dose_suggested=insulin.get("units") or 0.0, ate_recently=ate,
        stress_level=(stress or {}).get("level"), steps_today=today["steps"], hour=ctx["hour"],
        age=age_from(profile.get("birth_year")), weight_kg=profile.get("weight_kg"), recently_active=active,
        sitting_min=today.get("sitting_min"),
    )
    body = body_metrics(profile)
    last = max((r["time"] for r in ctx["readings"]), default=None)
    age = max(0, round((now - last).total_seconds() / 60)) if last else None
    meals_2h = [m for m in ctx["meals"] if timedelta(0) <= now - m["_t"] <= timedelta(hours=2)]
    if carbs:
        meals_2h.append({"food_name": "Planned meal", "carbs": carbs, "calories": 0, "_t": now})
    kcal = sum(float(m.get("calories") or 0) for m in ctx["meals"] if m["_t"] >= day_start)
    inputs = build_inputs(
        forecast=forecast, today=today, stress=stress, body=body, meals_2h=meals_2h, kcal_today=kcal,
        active_minutes=active_minutes, age_minutes=age, iob=iob)
    # Minutes on the chart count from the latest reading, like the forecast.
    start = health_data.parse_time(forecast["reading_at"]) if ready else now
    at = lambda t: round((t - start).total_seconds() / 60)
    recent = lambda t: timedelta(0) <= now - t <= timedelta(hours=1)
    moved = [(health_data.parse_time(r["logged_at"]), r) for r in today.get("manual") or []]
    return {
        "forecast": forecast, "insulin": insulin, "activity": activity, "stress": stress,
        "today": today, "body": body, "disclaimer": DISCLAIMER,
        "inputs": inputs,
        "links": build_links(
            forecast=forecast, insulin=insulin, activity=activity, inputs=inputs, stress_effect=shift,
            stress_level=level, recently_active=active),
        "recheck_minutes": recheck_minutes(forecast, insulin, level),
        # What happened in the last hour, for the shared time line.
        "events": [
            {"kind": "food", "minute": at(m["_t"]), "label": m.get("food_name") or "Meal",
             "amount": round(float(m.get("carbs") or 0))} for m in meals_2h if recent(m["_t"])
        ] + [
            {"kind": "insulin", "minute": at(d["_t"]), "label": "Insulin", "amount": float(d.get("dose_units") or 0)}
            for d in ctx["doses"] if recent(d["_t"])
        ] + [
            {"kind": "activity", "minute": at(t), "label": r["activity"], "amount": int(r["minutes"])}
            for t, r in moved if recent(t)
        ],
    }
