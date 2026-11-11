"""
Typical serving units for each dish the food classifier knows.

A photo cannot show how much food is on the plate, so the app asks the
user to choose a quantity in a unit that makes sense for the dish
(pieces of roti, plates of biryani, cups of chai) and scales nutrition
from these typical weights.

The gram weights are typical household portions, used as defaults the
user can change. They should be reviewed by a dietitian before launch.
"""

# unit: singular name shown to the user
# plural: plural name
# grams: typical weight of one unit
# kind: "count" for things counted in pieces (choices 1, 2, 3, 4),
#       "amount" for plates, bowls, cups (choices ½, 1, 1½, 2)

PLATE = ("plate", "plates", "amount")
BOWL = ("bowl", "bowls", "amount")
CUP = ("cup", "cups", "amount")
SERVING = ("serving", "servings", "amount")
SCOOP = ("scoop", "scoops", "count")
PIECE = ("piece", "pieces", "count")
SLICE = ("slice", "slices", "count")

_TABLE = {
    # Rice and mixed plates
    "biryani": (PLATE, 250),
    "fried rice": (PLATE, 250),
    "pav bhaji": (PLATE, 250),
    "chole bhature": (PLATE, 300),
    "bbq": (PLATE, 200),
    "chicken tikka": (PLATE, 200),
    "french fries": (SERVING, 120),
    "bread pudding": (SERVING, 150),

    # Curries, dals and salads
    "aloo gobi": (BOWL, 200),
    "bhindi fry": (BOWL, 180),
    "butter chicken": (BOWL, 250),
    "chicken curry": (BOWL, 250),
    "dal makhani": (BOWL, 200),
    "haleem": (BOWL, 300),
    "kadai paneer": (BOWL, 200),
    "beet salad": (BOWL, 150),
    "caesar salad": (BOWL, 150),
    "greek salad": (BOWL, 150),
    "edamame": (BOWL, 100),
    "guacamole": (SERVING, 50),
    "hummus": (SERVING, 50),

    # Breads
    "chapati": (("roti", "rotis", "count"), 60),
    "butter naan": (("naan", "naans", "count"), 100),
    "paratha": (("paratha", "parathas", "count"), 90),
    "garlic bread": (SLICE, 40),

    # Snacks and street food
    "samosa": (PIECE, 80),
    "pakode": (PIECE, 20),
    "momos": (PIECE, 25),
    "paani puri": (PIECE, 15),
    "idli": (PIECE, 40),
    "dhokla": (PIECE, 30),
    "masala dosa": (("dosa", "dosas", "count"), 150),
    "kaathi rolls": (("roll", "rolls", "count"), 180),
    "paratha roll": (("roll", "rolls", "count"), 200),
    "chicken wings": (PIECE, 35),
    "chicken quesadilla": (PIECE, 180),
    "hot dog": (PIECE, 100),
    "burger": (PIECE, 220),
    "pizza": (SLICE, 110),
    "omelette": (PIECE, 120),
    "pancakes": (PIECE, 40),
    "waffles": (PIECE, 75),

    # Sweets and drinks
    "jalebi": (PIECE, 25),
    "ras malai": (PIECE, 50),
    "kulfi": (PIECE, 70),
    "donuts": (PIECE, 60),
    "cupcakes": (PIECE, 60),
    "brownie": (PIECE, 60),
    "churros": (PIECE, 30),
    "cake": (SLICE, 100),
    "ice cream": (SCOOP, 65),
    "chai": (CUP, 200),
}

# Used for dishes not in the table (e.g. names from the fallback model).
_DEFAULT = (SERVING, 150)


def _normalise(name: str) -> str:
    return name.replace("_", " ").strip().lower()


def portion_for(food_name: str) -> dict:
    """The serving unit and typical weight for a dish name."""
    key = _normalise(food_name)
    (unit, plural, kind), grams = _TABLE.get(key, _DEFAULT)

    return {
        "unit": unit,
        "unit_plural": plural,
        "unit_grams": float(grams),
        "kind": kind,
    }
