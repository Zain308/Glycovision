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

    # ---- Names used by the GlycoVision model (ml/food/food_classes.json) ----

    # Rice plates
    "chicken pulao": (PLATE, 250),
    "daal chawal": (PLATE, 300),
    "plain rice": (PLATE, 200),
    "halwa puri": (PLATE, 300),

    # Salans, karahis and other curries
    "nihari": (BOWL, 250),
    "chicken karahi": (BOWL, 250),
    "mutton karahi": (BOWL, 250),
    "chicken qorma": (BOWL, 250),
    "aloo gosht": (BOWL, 250),
    "chicken salan": (BOWL, 250),
    "paya": (BOWL, 250),
    "keema": (BOWL, 200),
    "kofta": (BOWL, 200),
    "daal": (BOWL, 200),
    "chana": (BOWL, 200),
    "lobia": (BOWL, 200),
    "palak paneer": (BOWL, 200),

    # Sabzis
    "bhindi": (BOWL, 150),
    "saag": (BOWL, 200),
    "karela": (BOWL, 150),
    "baingan bharta": (BOWL, 150),
    "mix sabzi": (BOWL, 150),
    "aloo sabzi": (BOWL, 150),

    # Kebabs and fried meat
    "seekh kebab": (PIECE, 50),
    "chapli kebab": (PIECE, 100),
    "shami kebab": (PIECE, 50),
    "broast": (PIECE, 150),
    "fish fry": (PIECE, 100),
    "nuggets": (PIECE, 18),

    # Breads and breakfast
    "naan": (("naan", "naans", "count"), 100),
    "aloo paratha": (("paratha", "parathas", "count"), 150),
    "puri": (("puri", "puris", "count"), 30),
    "bread slice": (SLICE, 30),
    "bun": (PIECE, 50),
    "fried egg": (("egg", "eggs", "count"), 50),
    "boiled egg": (("egg", "eggs", "count"), 50),
    "cereal": (BOWL, 40),

    # Snacks and street food
    "pakora": (PIECE, 20),
    "chaat": (PLATE, 200),
    "gol gappay": (PIECE, 15),
    "dahi bhalla": (PLATE, 200),
    "spring roll": (PIECE, 60),
    "shawarma": (("roll", "rolls", "count"), 250),
    "sandwich": (PIECE, 150),
    "biscuits": (PIECE, 10),

    # Sweets
    "gulab jamun": (PIECE, 40),
    "kheer": (BOWL, 150),
    "gajar halwa": (SERVING, 100),
    "suji halwa": (SERVING, 100),
    "zarda": (SERVING, 150),
    "barfi": (PIECE, 30),

    # Drinks
    "lassi": (("glass", "glasses", "amount"), 250),
    "milk": (("glass", "glasses", "amount"), 250),
    "soft drink": (("glass", "glasses", "amount"), 250),
    "juice": (("glass", "glasses", "amount"), 250),
    "coffee": (CUP, 200),

    # Fruit, raita and salad
    "apple": (PIECE, 180),
    "banana": (PIECE, 120),
    "mango": (PIECE, 200),
    "orange": (PIECE, 150),
    "guava": (PIECE, 100),
    "dates": (PIECE, 8),
    "grapes": (CUP, 150),
    "watermelon": (SLICE, 280),
    "raita": (BOWL, 100),
    "salad": (BOWL, 100),
    "yogurt": (BOWL, 150),
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
