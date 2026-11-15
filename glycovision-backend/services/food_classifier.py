import json
import os
from functools import lru_cache

import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from torchvision import transforms
import timm


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MODEL_PATH = os.path.join(
    BASE_DIR,
    "models",
    "pakistani_food_model.pth",
)

CLASS_NAMES_PATH = os.path.join(
    BASE_DIR,
    "models",
    "class_names.json",
)

MODEL_ARCH = "convnext_tiny"

CONFIDENCE_THRESHOLD = 0.55


# GLYCOVISION_DEVICE forces a device ("cpu" on Hugging Face ZeroGPU, where
# a GPU only exists inside @spaces.GPU functions). Otherwise use CUDA when
# available.
device = torch.device(
    os.environ.get("GLYCOVISION_DEVICE")
    or ("cuda" if torch.cuda.is_available() else "cpu")
)


# IMPORTANT:
# During prediction we should NOT use:
# RandomRotation
# RandomHorizontalFlip
# ColorJitter
# RandomAffine
#
# Those belong only to training augmentation.

inference_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
])


class FoodClassifier:

    def __init__(self):
        self.class_names = self._load_class_names()

        self.model = timm.create_model(
            MODEL_ARCH,
            pretrained=False,
            num_classes=len(self.class_names),
        )

        state_dict = torch.load(
            MODEL_PATH,
            map_location=device,
            weights_only=True,
        )

        self.model.load_state_dict(state_dict)

        self.model.to(device)
        self.model.eval()

        print(
            f"[FoodClassifier] Loaded {MODEL_ARCH} "
            f"with {len(self.class_names)} classes on {device}"
        )

    def _load_class_names(self):
        if not os.path.exists(CLASS_NAMES_PATH):
            raise FileNotFoundError(
                f"class_names.json not found at {CLASS_NAMES_PATH}"
            )

        with open(CLASS_NAMES_PATH, "r", encoding="utf-8") as file:
            return json.load(file)

    def predict(self, image_path: str) -> dict:

        if not os.path.exists(image_path):
            raise FileNotFoundError(
                f"Image not found: {image_path}"
            )

        # Phone photos are often stored sideways with an EXIF orientation
        # flag; apply it so the model sees the plate the right way up
        # (training photos were prepared the same way).
        image = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")

        image_tensor = (
            inference_transform(image)
            .unsqueeze(0)
            .to(device)
        )

        with torch.inference_mode():

            logits = self.model(image_tensor)

            probabilities = F.softmax(
                logits,
                dim=1,
            )

            top_probs, top_indices = torch.topk(
                probabilities,
                k=min(3, len(self.class_names)),
                dim=1,
            )

        predictions = []

        for probability, index in zip(
            top_probs[0],
            top_indices[0],
        ):

            predictions.append({
                "food_name": self.class_names[index.item()],
                "confidence": round(
                    probability.item(),
                    4,
                ),
            })

        best = predictions[0]

        if best["food_name"] == "not_food":

            return {
                "is_food": False,
                "food_name": None,
                "confidence": best["confidence"],
                "top_predictions": predictions,
                "reason": "Model classified image as not food",
            }

        if best["confidence"] < CONFIDENCE_THRESHOLD:

            return {
                "is_food": False,
                "food_name": None,
                "confidence": best["confidence"],
                "top_predictions": predictions,
                "reason": "Prediction confidence too low",
            }

        return {
            "is_food": True,
            "food_name": best["food_name"],
            "confidence": best["confidence"],
            "top_predictions": predictions,
        }


@lru_cache()
def get_food_classifier() -> FoodClassifier:
    return FoodClassifier()


def predict_food(image_path: str) -> dict:
    classifier = get_food_classifier()

    return classifier.predict(image_path)