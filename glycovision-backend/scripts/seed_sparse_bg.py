from datetime import datetime, timedelta, timezone

from core.db import get_db
from scripts._common import seed_user_id


# =========================================================
# CONFIG
# =========================================================

USER_ID = seed_user_id()

# Intentionally ONLY 4 readings.
#
# These correspond to:
# t-60, t-30, t-15, current
#
# This should make the 24-feature dense model unavailable,
# while allowing the 11-feature sparse model to run.

SPARSE_READINGS = [
    (-60, 120),
    (-30, 145),
    (-15, 160),
    (0, 180),
]


# =========================================================
# CLEAR RECENT TEST DATA
# =========================================================

def clear_recent_bg():

    db = get_db()

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(hours=2)
    ).isoformat()

    print("\nClearing recent BG readings...")

    (
        db.table("bg_readings")
        .delete()
        .eq("user_id", USER_ID)
        .gte("logged_at", cutoff)
        .execute()
    )

    print("Recent BG readings cleared.")


# =========================================================
# INSERT SPARSE HISTORY
# =========================================================

def seed_sparse_history():

    db = get_db()

    # Use ONE reference timestamp for all four readings.
    now = datetime.now(timezone.utc)

    rows = []

    for minutes_offset, value in SPARSE_READINGS:

        logged_at = (
            now
            + timedelta(minutes=minutes_offset)
        ).isoformat()

        rows.append(
            {
                "user_id": USER_ID,
                "value": value,
                "logged_at": logged_at,
            }
        )

    (
        db.table("bg_readings")
        .insert(rows)
        .execute()
    )

    print("\n===========================================")
    print("SPARSE BG HISTORY SEEDED")
    print("===========================================")

    for minutes_offset, row in zip(
        [x[0] for x in SPARSE_READINGS],
        rows,
    ):

        if minutes_offset == 0:
            label = "CURRENT"
        else:
            label = f"T{minutes_offset}"

        print(
            f"{label:>7} | "
            f"{row['value']} mg/dL | "
            f"{row['logged_at']}"
        )

    print("\nTotal readings:", len(rows))

    print(
        "\nDense model should NOT have enough "
        "5-minute history."
    )

    print(
        "Sparse model SHOULD have the required "
        "60/30/15/current anchors."
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print("\n===========================================")
    print("GLYCOVISION SPARSE MODEL TEST")
    print("===========================================")

    clear_recent_bg()

    seed_sparse_history()

    print("\nDone.")
    print(
        "\nReload the Expo dashboard and inspect "
        "SPIKE RISK."
    )


if __name__ == "__main__":
    main()