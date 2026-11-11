from datetime import datetime, timedelta, timezone

from core.db import get_db
from scripts._common import seed_user_id


# =========================================================
# CONFIG
# =========================================================

# Same Supabase user currently logged into GlycoVision
USER_ID = seed_user_id()


# =========================================================
# TEST SCENARIOS
# =========================================================
#
# Each scenario contains exactly 13 readings:
#
# t-60, t-55, t-50, ... t-10, t-5, t
#
# This matches the glucose-history format expected by
# the GlycoVision app spike-prediction model.
#
# =========================================================

SCENARIOS = {

    # -----------------------------------------------------
    # STABLE
    #
    # Expected behavior:
    # Small BG changes
    # Lower model risk than rising scenario
    # -----------------------------------------------------

    "stable": [
        120,
        121,
        119,
        120,
        122,
        121,
        120,
        121,
        122,
        121,
        120,
        121,
        120,
    ],


    # -----------------------------------------------------
    # RISING
    #
    # Expected behavior:
    # Strong positive glucose trend
    # Elevated model risk expected
    # -----------------------------------------------------

    "rising": [
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
    ],


    # -----------------------------------------------------
    # FALLING
    #
    # Expected behavior:
    # Negative glucose trend
    # Lower risk than rising scenario expected
    # -----------------------------------------------------

    "falling": [
        180,
        176,
        172,
        168,
        163,
        158,
        153,
        148,
        143,
        138,
        133,
        128,
        122,
    ],
}


# =========================================================
# DELETE RECENT TEST BG
# =========================================================

def clear_recent_bg():
    """
    Remove recent BG readings for this development user
    before inserting a new synthetic test scenario.

    Only recent readings are removed.
    Older patient history is left untouched.
    """

    db = get_db()

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(hours=3)
    ).isoformat()

    print("\nClearing recent test BG readings...")

    db.table(
        "bg_readings"
    ).delete().eq(
        "user_id",
        USER_ID
    ).gte(
        "logged_at",
        cutoff
    ).execute()

    print("Recent test BG readings cleared.")


# =========================================================
# SEED SCENARIO
# =========================================================

def seed_scenario(
    scenario_name: str,
):
    """
    Insert 13 synthetic glucose readings,
    one every 5 minutes for the previous hour.
    """

    scenario_name = (
        scenario_name
        .strip()
        .lower()
    )


    # -----------------------------------------------------
    # VALIDATE SCENARIO
    # -----------------------------------------------------

    if scenario_name not in SCENARIOS:

        print("\nInvalid scenario.")

        print("\nAvailable scenarios:")

        for name in SCENARIOS:
            print(f"  - {name}")

        return


    values = SCENARIOS[
        scenario_name
    ]


    if len(values) != 13:

        raise ValueError(
            f"Scenario '{scenario_name}' must contain "
            f"exactly 13 glucose values."
        )


    db = get_db()


    # -----------------------------------------------------
    # REFERENCE TIME
    # -----------------------------------------------------
    #
    # The final reading becomes t=0.
    #
    # app_spike_predictor.py should later anchor its
    # feature grid to this latest glucose timestamp.
    #
    # -----------------------------------------------------

    reference_time = datetime.now(
        timezone.utc
    )


    rows = []


    # -----------------------------------------------------
    # BUILD 13 READINGS
    # -----------------------------------------------------

    for index, value in enumerate(
        values
    ):

        minutes_ago = (
            60
            - index * 5
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


    # -----------------------------------------------------
    # INSERT
    # -----------------------------------------------------

    db.table(
        "bg_readings"
    ).insert(
        rows
    ).execute()


    # -----------------------------------------------------
    # REPORT
    # -----------------------------------------------------

    print(
        "\n==========================================="
    )

    print(
        f"SCENARIO SEEDED: {scenario_name.upper()}"
    )

    print(
        "==========================================="
    )


    for index, row in enumerate(
        rows
    ):

        offset = (
            60
            - index * 5
        )

        if offset == 0:
            label = "CURRENT"
        else:
            label = f"T-{offset}m"

        print(
            f"{label:8s} | "
            f"{row['value']:6.1f} mg/dL | "
            f"{row['logged_at']}"
        )


    # -----------------------------------------------------
    # TREND SUMMARY
    # -----------------------------------------------------

    current_bg = values[-1]

    bg_15m = values[-4]

    bg_30m = values[-7]

    bg_60m = values[0]


    change_15m = (
        current_bg
        - bg_15m
    )

    change_30m = (
        current_bg
        - bg_30m
    )

    change_60m = (
        current_bg
        - bg_60m
    )


    print(
        "\n-------------------------------------------"
    )

    print(
        "EXPECTED FEATURE SUMMARY"
    )

    print(
        "-------------------------------------------"
    )

    print(
        f"Current BG:   {current_bg} mg/dL"
    )

    print(
        f"BG 15m ago:  {bg_15m} mg/dL"
    )

    print(
        f"BG 30m ago:  {bg_30m} mg/dL"
    )

    print(
        f"BG 60m ago:  {bg_60m} mg/dL"
    )

    print(
        f"15m change:  {change_15m:+} mg/dL"
    )

    print(
        f"30m change:  {change_30m:+} mg/dL"
    )

    print(
        f"60m change:  {change_60m:+} mg/dL"
    )


    print(
        "\n13/13 synthetic readings inserted."
    )

    print(
        "Reload the GlycoVision app to run the model."
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print(
        "\n==========================================="
    )

    print(
        "GLYCOVISION BG SCENARIO TESTER"
    )

    print(
        "==========================================="
    )


    print(
        "\nAvailable scenarios:"
    )

    for name in SCENARIOS:
        print(
            f"  - {name}"
        )


    selected = input(
        "\nChoose scenario: "
    )


    selected = (
        selected
        .strip()
        .lower()
    )


    # Do not delete existing data if the user
    # entered an invalid scenario.
    if selected not in SCENARIOS:

        print(
            "\nInvalid scenario."
        )

        print(
            "Nothing was deleted."
        )

        return


    clear_recent_bg()

    seed_scenario(
        selected
    )


if __name__ == "__main__":
    main()