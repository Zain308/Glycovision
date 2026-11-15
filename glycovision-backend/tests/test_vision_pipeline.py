"""
Food recognition decisions (services/vision.py) with the model mocked:
confident -> dish, unsure -> suggestions, not food -> nothing, and the
dish result never invents carbs.
"""

import pytest

from services import vision


def fake_prediction(top, is_food=None, threshold=0.55):
    best = top[0]
    food = best[0] != "not_food" and best[1] >= threshold
    return {
        "is_food": food if is_food is None else is_food,
        "food_name": best[0] if food else None,
        "confidence": best[1],
        "top_predictions": [{"food_name": n, "confidence": c} for n, c in top],
    }


@pytest.fixture
def no_fallback(monkeypatch):
    monkeypatch.setattr(vision, "USE_OLLAMA_FALLBACK", False)


def test_confident_prediction_is_used(monkeypatch, no_fallback):
    monkeypatch.setattr(vision, "predict_food", lambda p: fake_prediction([("biryani", 0.91), ("pulao", 0.05)]))
    d = vision.detect_food("x.jpg")
    assert d["food_name"] == "biryani" and d["source"] == "convnext"


def test_unsure_prediction_offers_choices(monkeypatch, no_fallback):
    monkeypatch.setattr(vision, "predict_food", lambda p: fake_prediction([("haleem", 0.35), ("nihari", 0.30), ("not_food", 0.10)]))
    d = vision.detect_food("x.jpg")
    assert d["unsure"] is True
    assert [s["food_name"] for s in d["suggestions"]] == ["haleem", "nihari"]  # not_food removed


def test_not_food_returns_nothing(monkeypatch, no_fallback):
    monkeypatch.setattr(vision, "predict_food", lambda p: fake_prediction([("not_food", 0.93), ("cake", 0.02)]))
    assert vision.detect_food("x.jpg") is None


def test_analyze_image_unsure_status(monkeypatch, no_fallback):
    monkeypatch.setattr(vision, "predict_food", lambda p: fake_prediction([("chana", 0.4), ("daal", 0.3)]))
    r = vision.analyze_image("x.jpg")
    assert r["status"] == "Not sure"
    assert r["ai_found"] == [] and r["suggested_bolus"] is None
    assert r["suggestions"][0]["display_name"] == "Chana"


def test_analyze_image_no_food(monkeypatch, no_fallback):
    monkeypatch.setattr(vision, "predict_food", lambda p: fake_prediction([("not_food", 0.9)]))
    r = vision.analyze_image("x.jpg")
    assert r["status"] == "No food detected" and r["summary"]["total_estimated_carbs"] == 0


def test_dish_with_nutrition_has_portion_and_carbs():
    r = vision.build_dish_result({"food_name": "chapati", "confidence": 0.9, "source": "convnext"})
    assert r["nutrition_found"] is True
    assert r["portion"]["unit"] == "roti" and r["portion"]["basis_grams"] == 100.0
    assert r["summary"]["total_estimated_carbs"] > 0


def test_dish_without_nutrition_never_invents_carbs():
    r = vision.build_dish_result({"food_name": "jalebi", "confidence": 0.9, "source": "convnext"})
    assert r["nutrition_found"] is False
    assert r["summary"]["total_estimated_carbs"] is None
    assert r["suggested_bolus"] is None
