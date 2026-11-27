"""
How the inputs lead to the outputs, in words and numbers the app can draw.

Inputs   sugar, food, stress, activity, body
Outputs  forecast (next 60 minutes), insulin, move (activity suggestion)

Every link says what that input is really doing right now. A link that does
nothing says so, and stress -> insulin is always "not used": stress must
never change a dose.
"""

from services.fitness import human_minutes

STRESS_WORD = {"calm": "Calm", "possible": "Possible", "elevated": "High"}
LITTLE = 3      # mg/dL; smaller effects are called "little effect"


def _mg(value: int) -> str:
    return f"{value:+d} mg/dL".replace("-", "−")


def _effect_text(value: int | None, what: str) -> str:
    if value is None:
        return f"Log a reading to see what {what} does."
    if abs(value) < LITTLE:
        return f"Little effect from {what} in the next hour."
    return f"{what.capitalize()}: {_mg(value)} in the next hour."


def _link(source: str, target: str, text: str, used: bool) -> dict:
    return {"from": source, "to": target, "text": text, "used": used}


def build_inputs(*, forecast, today, stress, body, meals_2h, kcal_today, active_minutes, age_minutes=None, iob=0.0) -> list[dict]:
    ready = forecast["status"] == "ready"
    bg = forecast.get("current_bg") if ready else forecast.get("last_bg")
    carbs = round(sum(float(m.get("carbs") or 0) for m in meals_2h))
    level = (stress or {}).get("level")
    steps, minutes = today.get("steps"), today.get("manual_minutes") or 0
    sitting = today.get("sitting_min") or 0
    bmi, bmr = (body or {}).get("bmi"), (body or {}).get("bmr_kcal")
    effects = forecast.get("effects") or {}

    old = age_minutes is not None and age_minutes > 15
    out = [
        {
            "key": "sugar", "label": "Blood sugar", "ready": ready,
            "value": str(bg) if bg is not None else None, "unit": "mg/dL",
            "note": "Too old, check again" if bg is not None and old else ("Just now" if (age_minutes or 0) < 2 else f"{round(age_minutes)} min ago") if bg is not None and age_minutes is not None else "Log it",
            "effect": effects.get("trend"),
        },
        {
            "key": "food", "label": "Food", "ready": bool(meals_2h),
            "value": str(carbs) if meals_2h else None, "unit": "g carbs",
            "note": meals_2h[-1].get("food_name") if meals_2h else "Scan a meal",
            "kcal_today": round(kcal_today), "effect": effects.get("food"),
        },
        {
            "key": "stress", "label": "Stress", "ready": level is not None,
            "value": STRESS_WORD.get(level), "unit": "",
            "note": f"From {stress['basis']}" if level else "Check your voice",
            "effect": effects.get("stress"),
        },
        {
            "key": "activity", "label": "Activity", "ready": steps is not None or minutes > 0,
            "value": f"{steps:,}" if steps is not None else (str(minutes) if minutes else None),
            "unit": "steps" if steps is not None else "min",
            "note": f"Still for {human_minutes(sitting)}" if sitting >= 60 else f"{active_minutes} min in last 2 h" if active_minutes else ("Today" if steps is not None or minutes else "Add activity"),
            "effect": effects.get("movement"),
        },
        {
            "key": "body", "label": "Body", "ready": bmi is not None,
            "value": str(bmi) if bmi is not None else None, "unit": "BMI",
            "note": f"BMR {bmr:,} kcal" if bmr else ("Add age and sex" if bmi else "Add height and weight"),
            "effect": None,
        },
    ]
    if iob >= 0.1:
        # Insulin already injected: not something to fill in, but it moves the hour.
        out.append({
            "key": "insulin", "label": "Active insulin", "ready": True, "value": f"{iob:.1f}", "unit": "units",
            "note": "From doses you logged", "effect": effects.get("insulin"),
        })
    return out


def build_links(*, forecast, insulin, activity, inputs, stress_effect, stress_level, recently_active) -> list[dict]:
    ready = forecast["status"] == "ready"
    effects = forecast.get("effects") or {}
    by = {i["key"]: i for i in inputs}
    dose_shown = insulin["status"] in ("dose", "none_needed", "hold")
    parts = insulin.get("breakdown") or {}
    carb_u = float(parts.get("carb_dose_units") or 0)
    corr_u = float(parts.get("correction_dose_units") or 0)
    links = []

    # ------------------------------------------------ into the forecast
    single = str(forecast.get("based_on", "")).startswith("single")
    if not ready:
        sugar = "Log a reading to start."
    elif single:
        sugar = "Starts from this reading. One more reading will show the trend."
    else:
        sugar = _effect_text(effects.get("trend"), "your sugar level and trend")
    links.append(_link("sugar", "forecast", sugar, ready))
    if by["food"]["ready"]:
        links.append(_link("food", "forecast", _effect_text(effects.get("food") if ready else None, "your food"), ready))
    else:
        links.append(_link("food", "forecast", "No food logged in the last 2 hours.", False))
    if stress_effect:
        links.append(_link("stress", "forecast", f"{_mg(round(stress_effect))} in the next hour, learned from your own checks.", ready))
    elif stress_level in ("possible", "elevated"):
        links.append(_link("stress", "forecast", "Stress can push sugar up. Your own effect is still being learned, so no number is added.", False))
    elif stress_level == "calm":
        links.append(_link("stress", "forecast", "Calm, so nothing is added.", False))
    else:
        links.append(_link("stress", "forecast", "Do a voice check to include stress.", False))
    if ready and forecast.get("used_watch"):
        links.append(_link("activity", "forecast", _effect_text(effects.get("movement"), "steps and heart rate"), True))
    else:
        links.append(_link("activity", "forecast", "Connect steps and heart rate to include them.", False))
    if effects.get("insulin"):
        links.append(_link("insulin", "forecast", f"Active insulin: {_mg(effects['insulin'])} in the next hour.", True))
    links.append(_link("body", "forecast", "Body size doesn't change the next hour.", False))

    # ------------------------------------------------ into the insulin dose
    if insulin["status"] != "not_needed":
        if dose_shown:
            if corr_u > 0:
                sugar = f"Sugar above target: +{corr_u:.1f} units."
            elif corr_u < 0:
                sugar = f"Sugar below target: −{-corr_u:.1f} units."
            else:
                sugar = "Not above your target, so no correction."
            links.append(_link("sugar", "insulin", sugar, True))
            links.append(_link("food", "insulin", f"{insulin.get('carbs', 0):g} g of carbs: {carb_u:+.1f} units." if carb_u else "No new food to cover.", bool(carb_u)))
            if recently_active:
                links.append(_link("activity", "insulin", "You were active, so the dose is checked against a safer limit (100 instead of 80).", True))
            else:
                links.append(_link("activity", "insulin", "No recent activity, so the usual safety limit is used.", False))
            links.append(_link("body", "insulin", insulin.get("weight_check") or "Your ratios fit your weight, or no weight is saved.", bool(insulin.get("weight_check"))))
            if insulin.get("iob"):
                links.append(_link("insulin", "insulin", f"{insulin['iob']:g} units from earlier doses are still working and are taken into account.", True))
        links.append(_link("stress", "insulin", "Never used. Stress can't change a dose.", False))

    # ------------------------------------------------ into the activity advice
    links.append(_link("sugar", "move", "Your sugar decides what is safe right now.", ready))
    links.append(_link("forecast", "move", activity["why"], activity["status"] != "need_reading"))
    links.append(_link("food", "move", "You ate recently, so a walk works best now." if by["food"]["ready"] else "No recent meal.", by["food"]["ready"]))
    if stress_level in ("possible", "elevated"):
        links.append(_link("stress", "move", "Slow breathing is added for stress.", True))
    else:
        links.append(_link("stress", "move", "No stress, so no breathing exercise is needed.", False))
    links.append(_link("activity", "move", "You have already moved, so it stays short." if recently_active else "You haven't moved much lately.", by["activity"]["ready"]))
    links.append(_link("body", "move", "Your weight sets the calories." if by["body"]["ready"] else "Add your weight to see calories.", by["body"]["ready"]))
    if (insulin.get("units") or 0) > 0 or (insulin.get("iob") or 0) >= 1:
        links.append(_link("insulin", "move", "Insulin is working, so only gentle activity is offered.", True))
    return links


def recheck_minutes(forecast, insulin, stress_level) -> int | None:
    """When to check again. Stress makes it earlier, never later."""
    if forecast["status"] != "ready":
        return 0
    if forecast["current_bg"] < 70 or forecast["low_probability"] >= 0.4:
        return 15
    if str(forecast["based_on"]).startswith("single"):
        base = 20
    elif forecast["alert"] in ("high", "watch"):
        base = 30
    else:
        base = 60
    if (insulin.get("units") or 0) > 0 or stress_level == "elevated":
        base = min(base, 45 if stress_level != "elevated" else 30)
    return base
