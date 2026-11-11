from models.schemas import (
    PatientState,
    BolusResponse,
    BolusBreakdown,
)


MAX_PROTOTYPE_DOSE = 15.0


def calculate_safe_bolus(
    state: PatientState,
) -> BolusResponse:

    """
    Prototype educational/research bolus calculation.

    This engine intentionally does NOT use voice-derived
    acoustic measurements to alter ISF or insulin dosing.

    Voice features are handled separately and may later be
    used as contextual inputs for glucose-spike prediction.
    """

    flags = []


    # -----------------------------------------------------
    # 1. MEAL COVERAGE
    # -----------------------------------------------------

    carb_dose = (
        state.total_carbs / state.icr
        if state.icr > 0
        else 0.0
    )


    # -----------------------------------------------------
    # 2. BG CORRECTION
    # -----------------------------------------------------

    correction = (
        (state.current_bg - state.target_bg)
        / state.isf
        if state.isf > 0
        else 0.0
    )


    # Never create a negative correction dose
    if correction < 0:

        correction = 0.0


    # -----------------------------------------------------
    # 3. INSULIN ON BOARD
    # -----------------------------------------------------

    raw_dose = (
        carb_dose
        + correction
        - state.iob
    )


    safe_dose = max(
        0.0,
        round(raw_dose, 1),
    )


    # -----------------------------------------------------
    # 4. SAFETY / PROTOTYPE FLAGS
    # -----------------------------------------------------

    if state.current_bg < 70:

        flags.append(
            "Low glucose detected. "
            "No dose estimate is provided."
        )

        safe_dose = 0.0


    if state.iob > 5:

        flags.append(
            "High insulin-on-board value. "
            "Potential insulin stacking risk."
        )


    if safe_dose > MAX_PROTOTYPE_DOSE:

        flags.append(
            "Calculated value exceeded the prototype safety cap."
        )

        safe_dose = MAX_PROTOTYPE_DOSE


    if state.current_bg > 250:

        flags.append(
            "Very high glucose reading. "
            "Clinical assessment may be appropriate."
        )


    # -----------------------------------------------------
    # 5. DESCRIPTION
    # -----------------------------------------------------

    strategy = (
        "Meal coverage + glucose correction "
        "- insulin on board"
    )


    # -----------------------------------------------------
    # 6. RESPONSE
    # -----------------------------------------------------

    return BolusResponse(

        status="Calculation complete",

        recommended_total_dose_units=safe_dose,

        breakdown=BolusBreakdown(

            carb_dose_units=round(
                carb_dose,
                2,
            ),

            correction_dose_units=round(
                correction,
                2,
            ),

            iob_subtracted=round(
                state.iob,
                2,
            ),
        ),

        strategy=strategy,

        disclaimer=(
            "Research prototype only. "
            "This calculation is not a prescription "
            "or substitute for individualized medical advice."
        ),

        safety_flags=flags,

        # Kept temporarily because your response schema
        # and frontend currently expect these fields.
        stress_score=None,

        stress_adjusted=False,
    )