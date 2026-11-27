"""
BMI, BMR and daily energy needs from the profile.

* BMI groups use the WHO Asian action points (23 and 27.5, WHO expert
  consultation, Lancet 2004), since South Asian patients carry risk at a
  lower BMI than the international 25/30 cutoffs suggest.
* BMR uses the Mifflin-St Jeor equation (1990), which is for adults.
* Adult BMI groups and BMR are not shown under 18.
"""

from datetime import datetime, timezone

# Multipliers on BMR for a whole day's energy use (standard activity factors).
ACTIVITY_FACTORS = [
    (5000, 1.2, "mostly sitting"),
    (7500, 1.375, "lightly active"),
    (10000, 1.55, "active"),
    (float("inf"), 1.725, "very active"),
]


def _num(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def age_from(birth_year, today_year: int | None = None) -> int | None:
    year = _num(birth_year)
    if year is None:
        return None
    age = (today_year or datetime.now(timezone.utc).year) - int(year)
    return age if 0 <= age <= 120 else None


def bmi_group(bmi: float) -> tuple[str, str]:
    if bmi < 18.5:
        return "underweight", "Underweight"
    if bmi < 23:
        return "healthy", "Healthy weight"
    if bmi < 27.5:
        return "overweight", "Overweight"
    return "obese", "Obese"


def bmr_kcal(sex: str, age: int, height_cm: float, weight_kg: float) -> float:
    return 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == "male" else -161)


def body_metrics(profile: dict | None, steps_per_day: float | None = None) -> dict:
    p = profile or {}
    height, weight = _num(p.get("height_cm")), _num(p.get("weight_kg"))
    sex, age = p.get("sex"), age_from(p.get("birth_year"))
    fields = (("height_cm", height), ("weight_kg", weight), ("sex", sex), ("birth_year", age))
    missing = [name for name, value in fields if value is None]

    out = {
        "complete": not missing, "missing": missing, "age": age,
        "bmi": None, "bmi_group": None, "bmi_label": None, "healthy_weight_kg": None,
        "bmr_kcal": None, "daily_kcal": None, "activity_label": None,
    }
    if not (height and weight):
        return out

    square = (height / 100) ** 2
    out["bmi"] = round(weight / square, 1)
    if age is not None and age < 18:
        out["bmi_label"] = "Under 18: ask your doctor for a growth chart"
        return out

    out["bmi_group"], out["bmi_label"] = bmi_group(out["bmi"])
    out["healthy_weight_kg"] = [round(18.5 * square), round(22.9 * square)]
    if sex in ("male", "female") and age is not None:
        bmr = bmr_kcal(sex, age, height, weight)
        out["bmr_kcal"] = round(bmr)
        if steps_per_day is not None:
            factor, label = next((f, l) for limit, f, l in ACTIVITY_FACTORS if steps_per_day < limit)
            out["daily_kcal"], out["activity_label"] = round(bmr * factor), label
    return out
