from datetime import datetime, timedelta, timezone

from core.db import get_db
from core.user_time import get_profile_row
from services.iob_engine import calculate_current_iob


def _nearest_bg(
    readings: list,
    target_time: datetime,
    tolerance_minutes: int = 10,
):
    """
    Finds the BG reading closest to target_time
    within the allowed tolerance.
    """

    best = None
    best_difference = None

    for reading in readings:

        logged_at = datetime.fromisoformat(
            reading["logged_at"].replace(
                "Z",
                "+00:00",
            )
        )

        difference = abs(
            (
                logged_at
                - target_time
            ).total_seconds()
        )

        if (
            best_difference is None
            or difference < best_difference
        ):
            best = reading
            best_difference = difference

    if best is None:
        return None

    if (
        best_difference
        > tolerance_minutes * 60
    ):
        return None

    return float(
        best["value"]
    )


def build_patient_snapshot(
    user_id: str,
) -> dict:

    db = get_db()

    now = datetime.now(
        timezone.utc
    )

    # -----------------------------------------------------
    # PROFILE
    # -----------------------------------------------------

    # limit(1) instead of .single(): a missing profile must not raise.
    profile = get_profile_row(db, user_id) or {}

    icr = float(
        profile.get("icr")
        or 10
    )

    isf = float(
        profile.get("isf")
        or 50
    )

    dia_hours = float(
        profile.get("dia_hours")
        or 4
    )


    # -----------------------------------------------------
    # BG HISTORY
    # -----------------------------------------------------

    bg_start = (
        now
        - timedelta(
            hours=2
        )
    ).isoformat()

    bg_res = (
        db.table("bg_readings")
        .select(
            "value, logged_at"
        )
        .eq(
            "user_id",
            user_id,
        )
        .gte(
            "logged_at",
            bg_start,
        )
        .order(
            "logged_at",
            desc=False,
        )
        .execute()
    )

    readings = (
        bg_res.data
        or []
    )


    if not readings:

        raise ValueError(
            "No recent glucose readings available."
        )


    current_bg = float(
        readings[-1]["value"]
    )


    bg_15m_ago = _nearest_bg(
        readings,
        now - timedelta(minutes=15),
    )

    bg_30m_ago = _nearest_bg(
        readings,
        now - timedelta(minutes=30),
    )

    bg_60m_ago = _nearest_bg(
        readings,
        now - timedelta(minutes=60),
    )


    # -----------------------------------------------------
    # RECENT MEAL
    # -----------------------------------------------------

    meal_start = (
        now
        - timedelta(
            hours=3
        )
    ).isoformat()

    meal_res = (
        db.table("meals")
        .select(
            "carbs, protein, fat, logged_at"
        )
        .eq(
            "user_id",
            user_id,
        )
        .gte(
            "logged_at",
            meal_start,
        )
        .order(
            "logged_at",
            desc=True,
        )
        .limit(1)
        .execute()
    )

    meals = (
        meal_res.data
        or []
    )


    if meals:

        recent_meal = meals[0]

        carbs = float(
            recent_meal.get("carbs")
            or 0
        )

        protein = float(
            recent_meal.get("protein")
            or 0
        )

        fat = float(
            recent_meal.get("fat")
            or 0
        )

    else:

        carbs = 0.0
        protein = 0.0
        fat = 0.0


    # -----------------------------------------------------
    # RECENT BOLUS
    # -----------------------------------------------------

    bolus_start = (
        now
        - timedelta(
            hours=3
        )
    ).isoformat()

    bolus_res = (
        db.table("bolus_logs")
        .select(
            "dose_units, logged_at"
        )
        .eq(
            "user_id",
            user_id,
        )
        .gte(
            "logged_at",
            bolus_start,
        )
        .order(
            "logged_at",
            desc=True,
        )
        .limit(1)
        .execute()
    )

    boluses = (
        bolus_res.data
        or []
    )

    recent_bolus = (
        float(
            boluses[0][
                "dose_units"
            ]
        )
        if boluses
        else 0.0
    )


    # -----------------------------------------------------
    # IOB
    # -----------------------------------------------------

    iob = calculate_current_iob(
        user_id,
        dia_hours,
    )


    # -----------------------------------------------------
    # RECENT ACOUSTIC CONTEXT
    # -----------------------------------------------------

    stress_start = (
        now
        - timedelta(
            hours=2
        )
    ).isoformat()

    stress_res = (
        db.table("stress_logs")
        .select(
            "stress_score, logged_at"
        )
        .eq(
            "user_id",
            user_id,
        )
        .gte(
            "logged_at",
            stress_start,
        )
        .order(
            "logged_at",
            desc=True,
        )
        .limit(1)
        .execute()
    )

    stress_rows = (
        stress_res.data
        or []
    )

    acoustic_score = (
        float(
            stress_rows[0][
                "stress_score"
            ]
        )
        if stress_rows
        else None
    )


    # -----------------------------------------------------
    # FINAL SNAPSHOT
    # -----------------------------------------------------

    return {

        "current_bg":
            current_bg,

        "bg_15m_ago":
            bg_15m_ago,

        "bg_30m_ago":
            bg_30m_ago,

        "bg_60m_ago":
            bg_60m_ago,

        "carbs":
            carbs,

        "protein":
            protein,

        "fat":
            fat,

        "iob":
            iob,

        "recent_bolus":
            recent_bolus,

        "icr":
            icr,

        "isf":
            isf,

        "acoustic_score":
            acoustic_score,

        "hour_of_day":
            now.hour,

        "generated_at":
            now.isoformat(),
    }