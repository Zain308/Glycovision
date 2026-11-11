import base64
import re
import requests

from models.schemas import NutrientInfo, DetectedItem
from core.config import get_settings
from services.food_classifier import predict_food
from services.portions import portion_for


settings = get_settings()


# ---------------------------------------------------------
# OPTIONAL OLLAMA FALLBACK
# ---------------------------------------------------------

# Local Ollama fallback; configured in .env (see .env.example).
OLLAMA_URL = settings.ollama_url
OLLAMA_MODEL = settings.ollama_model

USE_OLLAMA_FALLBACK = settings.use_ollama_fallback


VISION_PROMPT = """
Look at this photo and identify ONLY the food dish itself,
ignoring any text, logos, captions, or branding.

Respond with ONLY the specific food dish name in 1-4 words.

Examples:
chicken biryani
beef burger
samosa

If there is no food visible, respond with exactly:

no food
"""


# ---------------------------------------------------------
# LOCAL NUTRITION FALLBACK DATABASE
# ---------------------------------------------------------

FALLBACK = {
    "aloo gobi": {
        "carbs": 18,
        "protein": 5,
        "fat": 9,
        "calories": 170,
        "volume": "1 bowl (~200g)",
    },

    "bhindi fry": {
        "carbs": 12,
        "protein": 3,
        "fat": 10,
        "calories": 150,
        "volume": "1 bowl (~180g)",
    },

    "biryani": {
        "carbs": 62,
        "protein": 22,
        "fat": 18,
        "calories": 486,
        "volume": "1 plate (~250g)",
    },

    "butter chicken": {
        "carbs": 10,
        "protein": 28,
        "fat": 32,
        "calories": 420,
        "volume": "1 bowl (~250g)",
    },

    "chai": {
        "carbs": 15,
        "protein": 3,
        "fat": 4,
        "calories": 100,
        "volume": "1 cup (~200ml)",
    },

    "chapati": {
        "carbs": 33,
        "protein": 6,
        "fat": 3,
        "calories": 170,
        "volume": "1 piece (~60g)",
    },

    "chicken tikka": {
        "carbs": 4,
        "protein": 30,
        "fat": 14,
        "calories": 260,
        "volume": "4-5 pieces (~200g)",
    },

    "haleem": {
        "carbs": 30,
        "protein": 20,
        "fat": 15,
        "calories": 350,
        "volume": "1 bowl (~300g)",
    },

    "paratha": {
        "carbs": 40,
        "protein": 6,
        "fat": 15,
        "calories": 320,
        "volume": "1 piece (~90g)",
    },

    "karahi": {
        "carbs": 8,
        "protein": 42,
        "fat": 28,
        "calories": 452,
        "volume": "1 serving (~300g)",
    },

    "naan": {
        "carbs": 45,
        "protein": 9,
        "fat": 6,
        "calories": 262,
        "volume": "1 piece (~100g)",
    },

    "samosa": {
        "carbs": 24,
        "protein": 4,
        "fat": 12,
        "calories": 220,
        "volume": "1 piece (~80g)",
    },

    "burger": {
        "carbs": 42,
        "protein": 24,
        "fat": 18,
        "calories": 480,
        "volume": "1 burger",
    },

    "pizza": {
        "carbs": 36,
        "protein": 14,
        "fat": 12,
        "calories": 290,
        "volume": "1 slice",
    },

    "cake": {
        "carbs": 45,
        "protein": 5,
        "fat": 18,
        "calories": 350,
        "volume": "1 slice (~100g)",
    },
}


# ---------------------------------------------------------
# OLLAMA FALLBACK FUNCTION
# ---------------------------------------------------------

def _call_ollama_vision(image_path: str) -> dict | None:

    try:
        with open(image_path, "rb") as file:
            image_b64 = base64.b64encode(file.read()).decode("utf-8")

        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": VISION_PROMPT,
                "images": [image_b64],
                "stream": False,
            },
            timeout=120,
        )

        response.raise_for_status()

        raw_text = response.json().get("response", "")

        text = raw_text.strip().lower()

        print(f"[Ollama] raw response: {text!r}")

        if not text or "no food" in text:
            return None

        # The prompt asks for 1-4 words; small models sometimes answer
        # with a sentence, so keep only the first line and four words.
        first_line = text.splitlines()[0] if text.splitlines() else text
        food_name = " ".join(
            first_line.strip(" .").split()[:4]
        )

        if not food_name:
            return None

        return {
            "food_name": food_name,
            "confidence": 0.60,
            "source": "ollama_fallback",
        }

    except Exception as exc:
        print(f"[Ollama fallback error] {exc}")
        return None


# ---------------------------------------------------------
# PRIMARY FOOD RECOGNITION PIPELINE
# ---------------------------------------------------------

def detect_food(image_path: str) -> dict | None:

    prediction = predict_food(image_path)

    print("[ConvNeXt prediction]", prediction)

    # Primary success path
    if prediction["is_food"]:

        return {
            "food_name": prediction["food_name"],
            "confidence": prediction["confidence"],
            "source": "convnext",
            "top_predictions": prediction.get(
                "top_predictions",
                [],
            ),
        }

    # ConvNeXt rejected the image
    print(
        "[ConvNeXt rejected]",
        prediction.get("reason"),
    )

    # Only ask the fallback model when ConvNeXt was unsure. If ConvNeXt
    # confidently said "not food", a general model must not override it.
    classified_not_food = (
        prediction.get("top_predictions")
        and prediction["top_predictions"][0].get("food_name") == "not_food"
    )

    if USE_OLLAMA_FALLBACK and not classified_not_food:

        fallback_result = _call_ollama_vision(image_path)

        if fallback_result:
            return fallback_result

    return None


# ---------------------------------------------------------
# NUTRITION LOOKUP
# ---------------------------------------------------------

def fetch_nutrition(food_query: str) -> NutrientInfo | None:
    """
    Nutrition for a dish name, or None when no source knows it.

    Never invent values: carbs from this function can feed the bolus
    calculator, so an unknown dish must be reported as unknown.
    """

    api_key = (
        settings.calorieninjas_api_key
        or settings.food_ai_api_key
    )

    # ----------------------------
    # First try CalorieNinjas
    # ----------------------------

    if api_key:

        try:

            url = (
                "https://api.calorieninjas.com/v1/nutrition"
            )

            response = requests.get(
                url,
                headers={
                    "X-Api-Key": api_key
                },
                params={
                    "query": food_query
                },
                timeout=8,
            )

            if response.status_code == 200:

                items = response.json().get(
                    "items",
                    [],
                )

                if items:

                    item = items[0]

                    # CalorieNinjas reports nutrition for 100 g unless
                    # the query names a quantity.
                    try:
                        serving_size = float(
                            item.get("serving_size_g") or 100
                        )
                    except (TypeError, ValueError):
                        serving_size = 100.0
                    if serving_size <= 0:
                        serving_size = 100.0

                    return NutrientInfo(
                        name=food_query
                        .replace("_", " ")
                        .title(),

                        carbs=round(
                            item.get(
                                "carbohydrates_total_g",
                                0,
                            ),
                            1,
                        ),

                        protein=round(
                            item.get(
                                "protein_g",
                                0,
                            ),
                            1,
                        ),

                        fat=round(
                            item.get(
                                "fat_total_g",
                                0,
                            ),
                            1,
                        ),

                        calories=round(
                            item.get(
                                "calories",
                                0,
                            ),
                            1,
                        ),

                        fiber=round(
                            item.get(
                                "fiber_g",
                                0,
                            ),
                            1,
                        ),

                        volume=f"~{int(serving_size)}g",

                        basis_grams=serving_size,
                    )

        except Exception as exc:
            print(
                f"[Nutrition API error] {exc}"
            )

    # ----------------------------
    # Local fallback
    # ----------------------------

    query = food_query.lower()

    for key, value in FALLBACK.items():

        if key in query:

            # Table values describe the portion in "volume", e.g.
            # "1 plate (~250g)". Read its weight; entries without one
            # ("1 burger") describe one typical unit of that dish.
            weight = re.search(
                r"~\s*(\d+(?:\.\d+)?)\s*(?:g|ml)\b",
                value["volume"],
            )
            basis_grams = (
                float(weight.group(1))
                if weight
                else portion_for(key)["unit_grams"]
            )

            return NutrientInfo(
                name=food_query.replace("_", " ").title(),
                carbs=value["carbs"],
                protein=value["protein"],
                fat=value["fat"],
                calories=value["calories"],
                fiber=0.0,
                volume=value["volume"],
                basis_grams=basis_grams,
            )

    # Unknown food: report it instead of inventing values.
    return None


# ---------------------------------------------------------
# MAIN ANALYSIS FUNCTION
# ---------------------------------------------------------

def analyze_image(file_path: str) -> dict:

    detected = detect_food(file_path)

    # No reliable food detection
    if detected is None:

        return {
            "status": "No food detected",

            "summary": {
                "total_estimated_carbs": 0,
                "total_protein": 0,
                "total_fat": 0,
                "total_calories": 0,
            },

            "ai_found": [],

            "suggested_bolus": None,
        }

    food_name = detected["food_name"]

    nutrients = fetch_nutrition(food_name)

    model_info = {
        "source": detected["source"],
        "confidence": round(
            detected["confidence"],
            4,
        ),
        "top_predictions": detected.get(
            "top_predictions",
            [],
        ),
    }

    # Recognised the dish but no nutrition source knows it.
    if nutrients is None:

        display_name = (
            food_name.replace("_", " ").title()
        )

        return {
            "status": "Nutrition not found",
            "nutrition_found": False,
            "summary": {
                "total_estimated_carbs": None,
                "total_protein": None,
                "total_fat": None,
                "total_calories": None,
            },
            "ai_found": [
                DetectedItem(
                    food_name=display_name,
                    estimated_volume="Unknown",
                    nutrients=None,
                    confidence=round(
                        detected["confidence"],
                        4,
                    ),
                )
            ],
            "model": model_info,
            "suggested_bolus": None,
        }

    detected_item = DetectedItem(
        food_name=nutrients.name,
        estimated_volume=nutrients.volume,
        nutrients=nutrients,
        confidence=round(
            detected["confidence"],
            4,
        ),
    )

    return {

        "status": "Analysis successful",

        "nutrition_found": True,

        # The photo can't show quantity. The summary below describes
        # basis_grams of food; the app asks the user how much they ate
        # in the dish's natural unit and scales from there.
        "portion": {
            **portion_for(food_name),
            "basis_grams": nutrients.basis_grams,
        },

        "summary": {

            "total_estimated_carbs": round(
                nutrients.carbs,
                1,
            ),

            "total_protein": round(
                nutrients.protein,
                1,
            ),

            "total_fat": round(
                nutrients.fat,
                1,
            ),

            "total_calories": round(
                nutrients.calories,
                1,
            ),
        },

        "ai_found": [
            detected_item
        ],

        "model": model_info,

        "suggested_bolus": None,
    }