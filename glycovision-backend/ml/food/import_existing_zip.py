"""
Copy photos from the original food-image zip into the food-dataset folders.

The zip holds two image sets with their own folder names. This maps them to
our dish slugs (food_classes.json), copies each photo with a prefix showing
its source, and appends a row per dish to food-dataset/sources.csv.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\import_existing_zip.py <zip> <food-dataset>

The zip is only read, never changed. Re-running skips photos already copied.
"""

import csv
import sys
import zipfile
from collections import Counter
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# (top folder in zip, folder name in zip) -> our slug
MAPPING = {
    # "dataset" image set: 14 dishes, 100 photos each
    ("dataset", "bbq"): "bbq",
    ("dataset", "biryani"): "biryani",
    ("dataset", "brownie"): "brownie",
    ("dataset", "butter_chicken"): "butter_chicken",
    ("dataset", "chai"): "chai",
    ("dataset", "chapati"): "chapati",
    ("dataset", "chicken_tikka"): "chicken_tikka",
    ("dataset", "french_fries"): "french_fries",
    ("dataset", "fried_rice"): "fried_rice",
    ("dataset", "haleem"): "haleem",
    ("dataset", "omelette"): "omelette",
    ("dataset", "paratha"): "paratha",
    ("dataset", "paratha_roll"): "paratha_roll",
    ("dataset", "samosa"): "samosa",
    # "pakistani_dishes_dataset_2" image set: 12 dishes, 765 photos each
    ("pakistani_dishes_dataset_2", "Aloo gobi"): "aloo_gobi",
    ("pakistani_dishes_dataset_2", "Bhindi fry"): "bhindi",
    ("pakistani_dishes_dataset_2", "Biryani"): "biryani",
    ("pakistani_dishes_dataset_2", "Butter chicken"): "butter_chicken",
    ("pakistani_dishes_dataset_2", "Chai"): "chai",
    ("pakistani_dishes_dataset_2", "Chapati"): "chapati",
    ("pakistani_dishes_dataset_2", "Chicken tikka"): "chicken_tikka",
    ("pakistani_dishes_dataset_2", "Haleem"): "haleem",
    ("pakistani_dishes_dataset_2", "Paratha"): "paratha",
    ("pakistani_dishes_dataset_2", "Paratha roll"): "paratha_roll",
    ("pakistani_dishes_dataset_2", "Ras malai"): "ras_malai",
    ("pakistani_dishes_dataset_2", "Samosa"): "samosa",
}

PREFIX = {"dataset": "zipA", "pakistani_dishes_dataset_2": "zipB"}


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("Usage: python ml/food/import_existing_zip.py <zip> <food-dataset>")

    zip_path, dataset = Path(sys.argv[1]), Path(sys.argv[2])
    if not zip_path.is_file():
        sys.exit(f"Zip not found: {zip_path}")
    if not dataset.is_dir():
        sys.exit(f"Dataset folder not found: {dataset}")

    copied: Counter = Counter()
    skipped_existing = 0
    unmapped: Counter = Counter()

    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            parts = info.filename.split("/")
            if len(parts) < 3 or Path(parts[-1]).suffix.lower() not in IMAGE_EXTS:
                continue

            key = (parts[0], parts[-2])
            slug = MAPPING.get(key)
            if slug is None:
                unmapped[key] += 1
                continue

            target_dir = dataset / slug
            target_dir.mkdir(exist_ok=True)
            target = target_dir / f"{PREFIX[parts[0]]}_{parts[-1]}"
            if target.exists():
                skipped_existing += 1
                continue

            target.write_bytes(archive.read(info))
            copied[(parts[0], slug)] += 1

    # Record provenance for the thesis.
    sources = dataset / "sources.csv"
    new_file = not sources.exists()
    with sources.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["folder", "source", "licence", "photos", "notes"])
        for (image_set, slug), n in sorted(copied.items()):
            writer.writerow([
                slug,
                f"Original project zip ({zip_path.name}), image set '{image_set}'",
                "Check original dataset licence",
                n,
                f"file prefix {PREFIX[image_set]}_",
            ])

    print(f"Copied {sum(copied.values())} photos into {len(set(s for _, s in copied))} dish folders.")
    for (image_set, slug), n in sorted(copied.items(), key=lambda x: x[0][1]):
        print(f"  {slug:16} +{n:4}  from {image_set}")
    if skipped_existing:
        print(f"Skipped {skipped_existing} photos already copied earlier.")
    if unmapped:
        print("Folders in the zip with no mapping (not copied):")
        for (top, name), n in unmapped.items():
            print(f"  {top}/{name}: {n}")
    print(f"Sources recorded in {sources}")


if __name__ == "__main__":
    main()
