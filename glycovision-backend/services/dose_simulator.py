"""
Test a dose on the insulin curve before showing it.

The formula dose (services/bolus_engine) is the starting point. This module
plays it forward over the whole insulin action time with three things only:
the carbs still being absorbed, the insulin still active from logged doses,
and the new dose. If the sugar would drop below SAFE_MIN at any point, the
dose is lowered until it does not. It can NEVER raise the dose.

Why the full action time and not the next 60 minutes: with a 4-hour action
time only about 26 % of a dose has worked after one hour. Choosing a dose
to flatten the next hour would give roughly four times too much insulin and
a severe low later.

Why not the machine-learning forecast: it learned from people who inject
more when they eat more, so it cannot know what a different dose would do.

Simplifications (shown to the user as an estimate): basal insulin is
assumed to hold sugar level, carbs absorb over 3 hours with a peak at 45
minutes, and stress, illness and exercise are not simulated.
"""

from services.iob_engine import iob_fraction_remaining

SAFE_MIN = 80.0            # mg/dL the simulated sugar must not go below
SAFE_MIN_ACTIVE = 100.0    # after recent activity, which keeps lowering sugar
STEP_MIN = 5
CARB_MINUTES = 180.0
CARB_PEAK = 45.0
DOSE_STEP = 0.1

# Only rapid-acting insulin fits the 75-minute-peak curve in iob_engine.
INSULIN_INFO = {
    "rapid": {
        "name": "Rapid-acting insulin",
        "supported": True,
        "starts": "10 to 20 minutes",
        "strongest": "1 to 2 hours",
    },
    "regular": {"name": "Regular insulin", "supported": False},
    "premixed": {"name": "Premixed insulin", "supported": False},
    "other": {"name": "Other insulin", "supported": False},
}


def carb_fraction_absorbed(minutes: float) -> float:
    """Share of a meal's carbs absorbed after `minutes` (triangle-shaped rate)."""
    if minutes <= 0:
        return 0.0
    if minutes >= CARB_MINUTES:
        return 1.0
    if minutes <= CARB_PEAK:
        return minutes ** 2 / (CARB_PEAK * CARB_MINUTES)
    left = CARB_MINUTES - minutes
    return 1 - left ** 2 / (CARB_MINUTES * (CARB_MINUTES - CARB_PEAK))


def simulate(bg, isf, icr, dia_hours, doses=(), meals=(), new_dose=0.0) -> list[dict]:
    """
    Sugar every 5 minutes until the insulin and carbs are used up.
    doses: (units, minutes_ago); meals: (grams, minutes_ago).
    """
    dia = dia_hours * 60
    end = int(max(dia, CARB_MINUTES))
    points = []
    for t in range(0, end + 1, STEP_MIN):
        drop = sum(
            u * (iob_fraction_remaining(ago, dia) - iob_fraction_remaining(ago + t, dia)) for u, ago in doses
        )
        drop += new_dose * (1 - iob_fraction_remaining(t, dia))
        carbs = sum(g * (carb_fraction_absorbed(ago + t) - carb_fraction_absorbed(ago)) for g, ago in meals)
        points.append({"minute": t, "bg": bg + carbs * isf / icr - drop * isf})
    return points


def lowest(points) -> float:
    return min(p["bg"] for p in points)


def highest(points) -> float:
    return max(p["bg"] for p in points)


def check_dose(formula_dose, bg, isf, icr, dia_hours, doses=(), meals=(), safe_min=SAFE_MIN) -> dict:
    """Lower the formula dose until the simulated sugar stays at or above `safe_min`."""
    def run(units):
        return simulate(bg, isf, icr, dia_hours, doses, meals, units)

    without = run(0.0)
    units = round(max(0.0, formula_dose), 1)
    # A start between 70 and 80 is already under the limit. Holding that
    # against the dose would withhold all insulin for a meal and cause a
    # severe high, so there the path may not go below 70 and must end at
    # the limit or more.
    floor = safe_min if bg >= safe_min else 70.0

    def unsafe(points):
        return lowest(points) < floor or points[-1]["bg"] < safe_min

    while units > 0 and unsafe(run(units)):
        units = round(units - DOSE_STEP, 1)
    units = max(0.0, units)
    with_dose = run(units)

    def thin(points):
        return [{"minute": p["minute"], "bg": round(p["bg"])} for p in points if p["minute"] % 15 == 0]

    return {
        "formula_units": round(formula_dose, 1),
        "units": units,
        "lowered": units < round(formula_dose, 1),
        "peak_without": round(highest(without)),
        "peak_with": round(highest(with_dose)),
        "lowest_with": round(lowest(with_dose)),
        "end_without": round(without[-1]["bg"]),
        "end_with": round(with_dose[-1]["bg"]),
        "low_without_dose": lowest(without) < 70,
        "brings_down": with_dose[-1]["bg"] < without[-1]["bg"] - 5,
        "hours": round(with_dose[-1]["minute"] / 60, 1),
        "path_without": thin(without),
        "path_with": thin(with_dose),
    }
