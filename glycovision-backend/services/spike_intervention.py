from datetime import datetime, timezone

from services.app_spike_predictor import (
    predict_user_spike_risk,
)


# =========================================================
# HELPERS
# =========================================================

def _trend_description(
    bg_change_15m: float,
    bg_change_30m: float,
) -> str:

    if (
        bg_change_15m >= 10
        or
        bg_change_30m >= 20
    ):
        return "rising"

    if (
        bg_change_15m <= -10
        or
        bg_change_30m <= -20
    ):
        return "falling"

    return "stable"


def _build_ready_guidance(
    risk: dict,
) -> dict:

    risk_level = (
        risk.get(
            "risk_level",
            "unknown",
        )
    )

    current_bg = float(
        risk.get(
            "current_bg",
            0,
        )
        or 0
    )

    bg_change_15m = float(
        risk.get(
            "bg_change_15m",
            0,
        )
        or 0
    )

    bg_change_30m = float(
        risk.get(
            "bg_change_30m",
            0,
        )
        or 0
    )

    carbs_60m = float(
        risk.get(
            "carbs_60m",
            0,
        )
        or 0
    )

    bolus_60m = float(
        risk.get(
            "bolus_60m",
            0,
        )
        or 0
    )

    trend = (
        _trend_description(
            bg_change_15m,
            bg_change_30m,
        )
    )


    # -----------------------------------------------------
    # LOW
    # -----------------------------------------------------

    if risk_level == "low":

        return {
            "severity":
                "low",

            "title":
                "Glucose trend currently looks stable",

            "message":
                (
                    "Your short-term glucose-rise risk "
                    "is currently low."
                ),

            "recommended_next_step":
                (
                    "Continue monitoring your glucose "
                    "as you normally would."
                ),

            "trend":
                trend,
        }


    # -----------------------------------------------------
    # MODERATE
    # -----------------------------------------------------

    if risk_level == "moderate":

        message = (
            "Your recent glucose pattern shows some "
            "short-term rise risk."
        )

        if trend == "rising":

            message += (
                " Your glucose is also trending upward."
            )

        return {
            "severity":
                "moderate",

            "title":
                "Watch your glucose trend",

            "message":
                message,

            "recommended_next_step":
                (
                    "Keep monitoring your glucose and "
                    "check again when a new reading becomes "
                    "available."
                ),

            "trend":
                trend,
        }


    # -----------------------------------------------------
    # ELEVATED
    # -----------------------------------------------------

    message_parts = [
        (
            "GlycoVision detected an elevated likelihood "
            "of glucose rising within the next 60 minutes."
        )
    ]


    if trend == "rising":

        message_parts.append(
            (
                f"Your recent glucose trend is rising "
                f"({bg_change_15m:+.0f} mg/dL over 15 minutes)."
            )
        )


    if carbs_60m > 0:

        message_parts.append(
            (
                f"You logged approximately "
                f"{carbs_60m:.0f} g of carbohydrates "
                f"in the recent prediction window."
            )
        )


    if bolus_60m > 0:

        message_parts.append(
            (
                "A recent bolus is already recorded, "
                "so avoid using this risk score as a reason "
                "to take additional insulin."
            )
        )


    # -----------------------------------------------------
    # HIGH CURRENT BG CONTEXT
    # -----------------------------------------------------

    if current_bg >= 250:

        next_step = (
            "Continue monitoring closely. Because your "
            "current glucose is very high, follow your "
            "existing clinician-provided diabetes plan "
            "and seek clinical advice if needed."
        )

    elif current_bg >= 180:

        next_step = (
            "Monitor your glucose closely and check the "
            "next available reading. Follow your existing "
            "care plan rather than using this prediction "
            "to make medication changes."
        )

    else:

        next_step = (
            "Continue monitoring your glucose and check "
            "the next available reading. This prediction "
            "should not be used to change insulin dosing."
        )


    return {
        "severity":
            "elevated",

        "title":
            "Glucose may rise over the next hour",

        "message":
            " ".join(
                message_parts
            ),

        "recommended_next_step":
            next_step,

        "trend":
            trend,
    }


# =========================================================
# MAIN INTERVENTION SERVICE
# =========================================================

def build_spike_intervention(
    user_id: str,
) -> dict:

    risk = (
        predict_user_spike_risk(
            user_id
        )
    )


    # -----------------------------------------------------
    # STALE
    # -----------------------------------------------------

    if (
        risk.get(
            "status"
        )
        == "stale"
    ):

        return {
            "status":
                "stale",

            "severity":
                "info",

            "title":
                "Fresh glucose data needed",

            "message":
                risk.get(
                    "message"
                ),

            "recommended_next_step":
                (
                    "Log a new blood-glucose reading "
                    "before relying on a short-term "
                    "glucose-rise estimate."
                ),

            "risk":
                risk,

            "generated_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "disclaimer":
                (
                    "Research decision-support only. "
                    "This guidance is not medical advice "
                    "and must not be used for insulin dosing."
                ),
        }


    # -----------------------------------------------------
    # NOT READY
    # -----------------------------------------------------

    if (
        risk.get(
            "status"
        )
        == "not_ready"
    ):

        return {
            "status":
                "not_ready",

            "severity":
                "info",

            "title":
                "Building glucose history",

            "message":
                risk.get(
                    "message"
                ),

            "recommended_next_step":
                (
                    "Continue logging glucose readings. "
                    "GlycoVision will generate a risk "
                    "estimate when enough history is available."
                ),

            "risk":
                risk,

            "generated_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "disclaimer":
                (
                    "Research decision-support only. "
                    "This guidance is not medical advice "
                    "and must not be used for insulin dosing."
                ),
        }


    # -----------------------------------------------------
    # READY
    # -----------------------------------------------------

    if (
        risk.get(
            "status"
        )
        == "ready"
    ):

        guidance = (
            _build_ready_guidance(
                risk
            )
        )

        return {
            "status":
                "ready",

            "severity":
                guidance[
                    "severity"
                ],

            "title":
                guidance[
                    "title"
                ],

            "message":
                guidance[
                    "message"
                ],

            "recommended_next_step":
                guidance[
                    "recommended_next_step"
                ],

            "trend":
                guidance[
                    "trend"
                ],

            "risk_percent":
                risk.get(
                    "risk_percent"
                ),

            "risk_level":
                risk.get(
                    "risk_level"
                ),

            "prediction_mode":
                risk.get(
                    "prediction_mode"
                ),

            "current_bg":
                risk.get(
                    "current_bg"
                ),

            "risk":
                risk,

            "generated_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "disclaimer":
                (
                    "Research decision-support only. "
                    "Do not use this output for insulin "
                    "dosing or treatment decisions."
                ),
        }


    # -----------------------------------------------------
    # FALLBACK
    # -----------------------------------------------------

    return {
        "status":
            "unavailable",

        "severity":
            "info",

        "title":
            "Risk guidance unavailable",

        "message":
            (
                "GlycoVision could not generate "
                "short-term glucose guidance."
            ),

        "recommended_next_step":
            (
                "Continue normal glucose monitoring "
                "and try again later."
            ),

        "risk":
            risk,

        "generated_at":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "disclaimer":
            (
                "Research decision-support only."
            ),
    }