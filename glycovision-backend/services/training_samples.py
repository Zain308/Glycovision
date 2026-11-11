from datetime import datetime, timedelta, timezone

from core.db import get_db
from core.user_time import get_profile_row


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(
        value.replace("Z", "+00:00")
    )


def _nearest_value(
    rows: list,
    target_time: datetime,
    field: str,
    tolerance_minutes: int = 10,
):
    best_row = None
    best_diff = None

    for row in rows:
        row_time = _parse_time(
            row["logged_at"]
        )

        diff = abs(
            (
                row_time
                - target_time
            ).total_seconds()
        )

        if (
            best_diff is None
            or diff < best_diff
        ):
            best_diff = diff
            best_row = row

    if best_row is None:
        return None

    if (
        best_diff
        > tolerance_minutes * 60
    ):
        return None

    value = best_row.get(field)

    return (
        float(value)
        if value is not None
        else None
    )


def _get_latest_before(
    rows: list,
    reference_time: datetime,
):
    candidates = []

    for row in rows:
        row_time = _parse_time(
            row["logged_at"]
        )

        if row_time <= reference_time:
            candidates.append(
                (
                    row_time,
                    row,
                )
            )

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    return candidates[0][1]


def generate_training_samples(
    user_id: str,
    lookback_days: int = 30,
) -> dict:

    db = get_db()

    now = datetime.now(
        timezone.utc
    )

    start_time = (
        now
        - timedelta(
            days=lookback_days
        )
    ).isoformat()


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


    # -----------------------------------------------------
    # BG READINGS
    # -----------------------------------------------------

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
            start_time,
        )
        .order(
            "logged_at",
            desc=False,
        )
        .execute()
    )

    bg_rows = (
        bg_res.data
        or []
    )


    # Need enough BG data to build
    # history + future labels.
    if len(bg_rows) < 5:
        return {
            "created": 0,
            "skipped": 0,
            "total_bg_readings": len(bg_rows),
            "message": "Not enough BG readings to build training samples.",
        }


    # -----------------------------------------------------
    # MEALS
    # -----------------------------------------------------

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
            start_time,
        )
        .order(
            "logged_at",
            desc=False,
        )
        .execute()
    )

    meals = (
        meal_res.data
        or []
    )


    # -----------------------------------------------------
    # BOLUSES
    # -----------------------------------------------------

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
            start_time,
        )
        .order(
            "logged_at",
            desc=False,
        )
        .execute()
    )

    boluses = (
        bolus_res.data
        or []
    )


    # -----------------------------------------------------
    # VOICE / ACOUSTIC
    # -----------------------------------------------------

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
            start_time,
        )
        .order(
            "logged_at",
            desc=False,
        )
        .execute()
    )

    stress_rows = (
        stress_res.data
        or []
    )


    # -----------------------------------------------------
    # CREATE SAMPLES
    # -----------------------------------------------------

    created = 0
    skipped = 0


    for current_row in bg_rows:

        sample_time = _parse_time(
            current_row["logged_at"]
        )

        current_bg = float(
            current_row["value"]
        )


        # ---------------------------------------------
        # HISTORICAL BG
        # ---------------------------------------------

        bg_15m = _nearest_value(
            bg_rows,
            sample_time
            - timedelta(minutes=15),
            "value",
        )

        bg_30m = _nearest_value(
            bg_rows,
            sample_time
            - timedelta(minutes=30),
            "value",
        )

        bg_60m = _nearest_value(
            bg_rows,
            sample_time
            - timedelta(minutes=60),
            "value",
        )


        # ---------------------------------------------
        # FUTURE LABELS
        # ---------------------------------------------

        target_30m = _nearest_value(
            bg_rows,
            sample_time
            + timedelta(minutes=30),
            "value",
        )

        target_60m = _nearest_value(
            bg_rows,
            sample_time
            + timedelta(minutes=60),
            "value",
        )

        target_90m = _nearest_value(
            bg_rows,
            sample_time
            + timedelta(minutes=90),
            "value",
        )

        target_120m = _nearest_value(
            bg_rows,
            sample_time
            + timedelta(minutes=120),
            "value",
        )


        # We need the target labels.
        if (
            target_30m is None
            or target_60m is None
            or target_90m is None
            or target_120m is None
        ):

            skipped += 1
            continue


        # ---------------------------------------------
        # RECENT MEAL
        # ---------------------------------------------

        recent_meal = (
            _get_latest_before(
                meals,
                sample_time,
            )
        )


        if recent_meal:

            meal_time = _parse_time(
                recent_meal["logged_at"]
            )

            meal_age_minutes = (
                sample_time
                - meal_time
            ).total_seconds() / 60


            # Only use meals from last 3h
            if (
                0
                <= meal_age_minutes
                <= 180
            ):

                carbs = float(
                    recent_meal.get(
                        "carbs"
                    )
                    or 0
                )

                protein = float(
                    recent_meal.get(
                        "protein"
                    )
                    or 0
                )

                fat = float(
                    recent_meal.get(
                        "fat"
                    )
                    or 0
                )

            else:

                carbs = 0.0
                protein = 0.0
                fat = 0.0

        else:

            carbs = 0.0
            protein = 0.0
            fat = 0.0


        # ---------------------------------------------
        # RECENT BOLUS
        # ---------------------------------------------

        recent_bolus_row = (
            _get_latest_before(
                boluses,
                sample_time,
            )
        )


        if recent_bolus_row:

            bolus_time = _parse_time(
                recent_bolus_row["logged_at"]
            )

            bolus_age = (
                sample_time
                - bolus_time
            ).total_seconds() / 60


            if (
                0
                <= bolus_age
                <= 180
            ):

                recent_bolus = float(
                    recent_bolus_row[
                        "dose_units"
                    ]
                    or 0
                )

            else:

                recent_bolus = 0.0

        else:

            recent_bolus = 0.0


        # ---------------------------------------------
        # APPROXIMATE IOB
        # ---------------------------------------------
        #
        # For training-sample generation,
        # we keep this simple for now.
        #
        # Later we can calculate historical IOB
        # exactly at sample_time.
        #

        iob = recent_bolus


        # ---------------------------------------------
        # ACOUSTIC SCORE
        # ---------------------------------------------

        recent_stress = (
            _get_latest_before(
                stress_rows,
                sample_time,
            )
        )


        acoustic_score = None

        if recent_stress:

            stress_time = _parse_time(
                recent_stress["logged_at"]
            )

            stress_age = (
                sample_time
                - stress_time
            ).total_seconds() / 60


            if (
                0
                <= stress_age
                <= 120
            ):

                acoustic_score = float(
                    recent_stress[
                        "stress_score"
                    ]
                )


        # ---------------------------------------------
        # SPIKE LABEL
        # ---------------------------------------------

        future_values = [
            target_30m,
            target_60m,
            target_90m,
            target_120m,
        ]

        expected_peak = max(
            future_values
        )


        # Initial research definition:
        #
        # A "spike" occurs if either:
        #
        # 1. future BG exceeds 180
        #
        # OR
        #
        # 2. BG rises at least 40 mg/dL
        #    above current BG.
        #

        spike_occurred = (
            expected_peak >= 180
            or
            expected_peak
            - current_bg
            >= 40
        )


        # ---------------------------------------------
        # SAVE
        # ---------------------------------------------

        sample = {

            "user_id":
                user_id,

            "sample_time":
                sample_time.isoformat(),

            "current_bg":
                current_bg,

            "bg_15m_ago":
                bg_15m,

            "bg_30m_ago":
                bg_30m,

            "bg_60m_ago":
                bg_60m,

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
                sample_time.hour,

            "target_bg_30m":
                target_30m,

            "target_bg_60m":
                target_60m,

            "target_bg_90m":
                target_90m,

            "target_bg_120m":
                target_120m,

            "spike_occurred":
                spike_occurred,
        }


        db.table(
            "training_samples"
        ).insert(
            sample
        ).execute()


        created += 1


    return {

        "created":
            created,

        "skipped":
            skipped,

        "total_bg_readings":
            len(bg_rows),
    }