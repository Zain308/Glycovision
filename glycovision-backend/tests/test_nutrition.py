"""
Nutrition table (services/nutrition_table.json) and portions
(services/portions.py): the carbs shown to the user drive the dose.
"""

import json
from pathlib import Path

import pytest

from services import portions
from services.vision import NUTRITION_TABLE, _table_nutrition, fetch_nutrition

ROOT = Path(__file__).resolve().parents[1]
MODEL_CLASSES = json.loads((ROOT / "models/class_names.json").read_text())
ALL_DISHES = json.loads((ROOT / "ml/food/food_classes.json").read_text())
ALL_DISHES = [d if isinstance(d, str) else d.get("slug") for d in (ALL_DISHES if isinstance(ALL_DISHES, list) else ALL_DISHES.get("classes", ALL_DISHES))]

# No trustworthy published value: the app must ask the user for carbs.
KNOWN_GAPS = {"gol_gappay", "gulab_jamun", "haleem", "jalebi", "paya"}


def test_every_model_dish_has_nutrition_or_is_a_known_gap():
    missing = [c for c in MODEL_CLASSES if c != "not_food" and c not in NUTRITION_TABLE and c not in KNOWN_GAPS]
    assert missing == []


def test_known_gaps_really_return_unknown():
    for dish in KNOWN_GAPS:
        assert _table_nutrition(dish) is None


@pytest.mark.parametrize("dish", sorted(NUTRITION_TABLE))
def test_values_are_physically_plausible(dish):
    v = NUTRITION_TABLE[dish]["per_100g"]
    for k in ("carbs", "protein", "fat", "calories", "fiber"):
        assert v[k] >= 0, k
    # 100 g of food cannot hold more than 100 g of nutrients.
    assert v["carbs"] + v["protein"] + v["fat"] <= 100.5
    assert v["calories"] <= 900  # pure fat is ~900 kcal/100 g
    # Atwater check: kcal ≈ 4·carbs + 4·protein + 9·fat (within 25 % / 25 kcal).
    atwater = 4 * v["carbs"] + 4 * v["protein"] + 9 * v["fat"]
    assert abs(atwater - v["calories"]) <= max(25, 0.25 * v["calories"]), (atwater, v["calories"])


@pytest.mark.parametrize("dish", sorted(NUTRITION_TABLE))
def test_every_entry_cites_a_source(dish):
    e = NUTRITION_TABLE[dish]
    assert e["match"] in {"exact", "close", "composite"}
    assert e["parts"] and all(p["source"] and p["code"] for p in e["parts"])


@pytest.mark.parametrize("dish,lo,hi", [
    ("chapati", 30, 50), ("naan", 40, 60), ("plain_rice", 22, 32), ("puri", 30, 55),
    ("samosa", 25, 45), ("banana", 18, 26), ("soft_drink", 8, 13), ("milk", 3, 6),
    ("boiled_egg", 0, 2), ("seekh_kebab", 0, 10),
])
def test_carbs_match_common_knowledge(dish, lo, hi):
    """Sanity ranges (g carbs / 100 g) a dietitian would expect."""
    assert lo <= NUTRITION_TABLE[dish]["per_100g"]["carbs"] <= hi


@pytest.mark.parametrize("query", ["chapati", "Chapati", "CHAPATI", " chapati ", "chicken_tikka", "chicken tikka", "Chicken Tikka"])
def test_lookup_ignores_case_and_spaces(query):
    assert _table_nutrition(query) is not None


def test_no_substring_false_matches():
    """'paratha' must not answer for 'paratha_roll' (old fallback bug)."""
    a = _table_nutrition("paratha")
    b = _table_nutrition("paratha_roll")
    assert a.carbs != b.carbs


def test_unknown_food_is_none_not_invented():
    assert _table_nutrition("pizza_hawaiian_xl") is None
    assert fetch_nutrition("definitely not a dish") is None


def test_lookup_basis_is_100g():
    n = _table_nutrition("biryani")
    assert n.basis_grams == 100.0 and n.source and n.match


# ---------------------------------------------------------------- portions

@pytest.mark.parametrize("dish", [d for d in ALL_DISHES if d != "not_food"])
def test_every_dish_has_a_specific_portion(dish):
    key = portions._normalise(dish)
    assert key in portions._TABLE, f"{dish} falls back to the generic 150 g serving"


@pytest.mark.parametrize("dish", [d for d in ALL_DISHES if d != "not_food"])
def test_portion_weights_are_realistic(dish):
    p = portions.portion_for(dish)
    assert 5 <= p["unit_grams"] <= 400
    assert p["kind"] in {"count", "amount"}


def test_portion_default_for_unknown():
    p = portions.portion_for("mystery_food")
    assert p["unit"] == "serving" and p["unit_grams"] == 150.0
