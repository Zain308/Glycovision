from datetime import datetime, timedelta, timezone

from core.db import get_db
from scripts._common import seed_user_id


# ---------------------------------------------------------
# IMPORTANT
# ---------------------------------------------------------
# Data is written for SEED_USER_ID from .env: use the same
# Supabase user you are logged into from the Expo app.
#
# You can copy it from Supabase:
# Authentication -> Users -> User UID
# ---------------------------------------------------------

USER_ID = seed_user_id()


# ---------------------------------------------------------
# TEST GLUCOSE PATTERN
# ---------------------------------------------------------
# 13 readings = 60 minutes of history at 5-minute intervals.
#
# This example rises gradually:
#
# 120 -> 125 -> ... -> 170
#
# Good for testing whether the model can produce a real
# risk score.
# ---------------------------------------------------------

GLUCOSE_VALUES = [
    120,
    122,
    124,
    126,
    129,
    132,
    136,
    140,
    145,
    150,
    156,
    163,
    170,
]


def main():

    if USER_ID == "PASTE_YOUR_USER_UUID_HERE":
        raise ValueError(
            "Set USER_ID before running this script."
        )

    db = get_db()

    now = datetime.now(
        timezone.utc
    )

    rows = []

    # GLUCOSE_VALUES[0] = 60 minutes ago
    # GLUCOSE_VALUES[-1] = current reading

    for index, value in enumerate(
        GLUCOSE_VALUES
    ):

        minutes_ago = (
            60 - index * 5
        )

        logged_at = (
            now
            - timedelta(
                minutes=minutes_ago
            )
        ).isoformat()

        rows.append({
            "user_id": USER_ID,
            "value": value,
            "logged_at": logged_at,
        })

    print("\nSeeding BG history...")
    print(f"User: {USER_ID}")
    print(f"Readings: {len(rows)}")

    result = (
        db.table(
            "bg_readings"
        )
        .insert(
            rows
        )
        .execute()
    )

    print("\nInserted readings:")

    for row in rows:
        print(
            f"{row['logged_at']} -> "
            f"{row['value']} mg/dL"
        )

    print("\nDone.")


if __name__ == "__main__":
    main()