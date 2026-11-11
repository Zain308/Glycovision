from datetime import datetime, timedelta, timezone

from core.db import get_db
from scripts._common import seed_user_id


# =========================================================
# CONFIG
# =========================================================

USER_ID = seed_user_id()

# Deliberately insufficient history.
#
# We provide only:
# t-10
# t-5
# current
#
# Dense model cannot run because it needs the complete
# 5-minute history.
#
# Sparse model cannot run because it needs approximately:
# t-60, t-30, t-15, current.

TEST_READINGS = [
    (-10, 150),
    (-5, 155),
    (0, 160),
]


# =========================================================
# CLEAR RECENT BG
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
# SEED INSUFFICIENT HISTORY
# =========================================================

def seed_insufficient_history():

    db = get_db()

    now = datetime.now(timezone.utc)

    rows = []

    for minutes_offset, value in TEST_READINGS:

        logged_at = (
            now
            + timedelta(
                minutes=minutes_offset
            )
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
    print("INSUFFICIENT BG HISTORY SEEDED")
    print("===========================================")

    for (
        minutes_offset,
        value,
    ) in TEST_READINGS:

        if minutes_offset == 0:
            label = "CURRENT"
        else:
            label = f"T{minutes_offset}"

        print(
            f"{label:>7} -> "
            f"{value} mg/dL"
        )

    print("\nTotal readings:", len(rows))

    print("\nExpected result:")
    print("  Fresh BG:       YES")
    print("  Dense ready:    NO")
    print("  Sparse ready:   NO")
    print("  Final status:   not_ready")


# =========================================================
# MAIN
# =========================================================

def main():

    print("\n===========================================")
    print("GLYCOVISION NOT-READY TEST")
    print("===========================================")

    clear_recent_bg()

    seed_insufficient_history()

    print(
        "\nNow reload the Expo dashboard."
    )


if __name__ == "__main__":
    main()