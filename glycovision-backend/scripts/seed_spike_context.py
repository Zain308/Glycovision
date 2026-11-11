from datetime import datetime, timedelta, timezone

from core.db import get_db
from scripts._common import seed_user_id


USER_ID = seed_user_id()


# =========================================================
# RISING BG HISTORY
# =========================================================

BG_VALUES = [
    120,
    123,
    126,
    130,
    135,
    140,
    146,
    152,
    158,
    164,
    170,
    176,
    182,
]


SCENARIOS = {
    "a": {
        "name": "Rising BG / no carbs / no bolus",
        "carbs": None,
        "bolus": None,
    },

    "b": {
        "name": "Rising BG / carbs / no bolus",
        "carbs": 45,
        "bolus": None,
    },

    "c": {
        "name": "Rising BG / carbs / bolus",
        "carbs": 45,
        "bolus": 5.0,
    },
}


# =========================================================
# CLEAN RECENT TEST DATA
# =========================================================

def clear_recent_test_data():

    db = get_db()

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(hours=3)
    ).isoformat()

    print("\nClearing recent BG, meal and bolus test data...")

    db.table(
        "bg_readings"
    ).delete().eq(
        "user_id",
        USER_ID
    ).gte(
        "logged_at",
        cutoff
    ).execute()

    db.table(
        "meals"
    ).delete().eq(
        "user_id",
        USER_ID
    ).gte(
        "logged_at",
        cutoff
    ).execute()

    db.table(
        "bolus_logs"
    ).delete().eq(
        "user_id",
        USER_ID
    ).gte(
        "logged_at",
        cutoff
    ).execute()

    print("Recent test data cleared.")


# =========================================================
# SEED BG HISTORY
# =========================================================

def seed_bg_history(reference_time):

    db = get_db()

    rows = []

    for index, value in enumerate(BG_VALUES):

        minutes_ago = (
            60 - index * 5
        )

        logged_at = (
            reference_time
            - timedelta(
                minutes=minutes_ago
            )
        ).isoformat()

        rows.append({
            "user_id": USER_ID,
            "value": float(value),
            "logged_at": logged_at,
        })

    db.table(
        "bg_readings"
    ).insert(
        rows
    ).execute()

    print("13 BG readings inserted.")


# =========================================================
# SEED MEAL
# =========================================================

def seed_meal(
    reference_time,
    carbs,
):

    if carbs is None:
        return

    db = get_db()

    meal_time = (
        reference_time
        - timedelta(minutes=30)
    ).isoformat()

    db.table(
        "meals"
    ).insert({
        "user_id": USER_ID,
        "food_name": "Test Meal",
        "carbs": float(carbs),
        "protein": 10,
        "fat": 8,
        "calories": 300,
        "logged_at": meal_time,
    }).execute()

    print(
        f"Meal inserted: {carbs}g carbs at t-30m"
    )


# =========================================================
# SEED BOLUS
# =========================================================

def seed_bolus(
    reference_time,
    bolus,
):

    if bolus is None:
        return

    db = get_db()

    bolus_time = (
        reference_time
        - timedelta(minutes=25)
    ).isoformat()

    db.table(
        "bolus_logs"
    ).insert({
        "user_id": USER_ID,
        "dose_units": float(bolus),
        "carbs": 45,
        "current_bg": 140,
        "logged_at": bolus_time,
    }).execute()

    print(
        f"Bolus inserted: {bolus}u at t-25m"
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print("\n===========================================")
    print("GLYCOVISION SPIKE CONTEXT TESTER")
    print("===========================================")

    print("\nChoose scenario:\n")

    print(
        "A - Rising BG / no carbs / no bolus"
    )

    print(
        "B - Rising BG / 45g carbs / no bolus"
    )

    print(
        "C - Rising BG / 45g carbs / 5u bolus"
    )

    selected = input(
        "\nScenario: "
    ).strip().lower()

    if selected not in SCENARIOS:

        print(
            "\nInvalid scenario."
        )

        return

    scenario = (
        SCENARIOS[selected]
    )

    print(
        f"\nSelected: {scenario['name']}"
    )

    clear_recent_test_data()

    reference_time = datetime.now(
        timezone.utc
    )

    seed_bg_history(
        reference_time
    )

    seed_meal(
        reference_time,
        scenario["carbs"],
    )

    seed_bolus(
        reference_time,
        scenario["bolus"],
    )

    print("\n===========================================")
    print("TEST DATA READY")
    print("===========================================")

    print(
        f"Current BG: {BG_VALUES[-1]}"
    )

    print(
        f"BG change 15m: "
        f"{BG_VALUES[-1] - BG_VALUES[-4]:+}"
    )

    print(
        f"BG change 30m: "
        f"{BG_VALUES[-1] - BG_VALUES[-7]:+}"
    )

    print(
        f"Carbs last 60m: "
        f"{scenario['carbs'] or 0}g"
    )

    print(
        f"Bolus last 60m: "
        f"{scenario['bolus'] or 0}u"
    )

    print(
        "\nReload Expo and check the "
        "60-Minute Glucose Risk card."
    )


if __name__ == "__main__":
    main()