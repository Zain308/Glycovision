"""
Run the food classifier on one image.

Usage (from glycovision-backend):
    python -m scripts.check_food_classifier path/to/photo.jpg
"""

import sys

from services.food_classifier import predict_food

if len(sys.argv) != 2:
    sys.exit("Usage: python -m scripts.check_food_classifier path/to/photo.jpg")

result = predict_food(sys.argv[1])

print()
print("Prediction Result")
print("-----------------")
print(result)
