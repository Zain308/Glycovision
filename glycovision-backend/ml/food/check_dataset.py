"""
Check a food photo dataset before training.

Expected layout (one folder per dish, folder name = slug in food_classes.json):

    food-dataset/
        biryani/      photo1.jpg, photo2.jpg, ...
        nihari/       ...
        not_food/     ...

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\check_dataset.py E:\\Glycovision\\food-dataset

It reports photos per dish, missing dishes, unknown folders, broken or tiny
images and exact duplicates, and writes dataset_report.csv next to the
dataset. Nothing is changed or deleted.
"""

import csv
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, UnidentifiedImageError

HERE = Path(__file__).resolve().parent
CLASSES = json.loads((HERE / "food_classes.json").read_text(encoding="utf-8"))

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MIN_SIDE = 160          # smaller images are too blurry to learn from
TARGET = 300            # good
ENOUGH = 150            # minimum to include a dish in training


def status_for(count: int) -> str:
    if count >= TARGET:
        return "GOOD"
    if count >= ENOUGH:
        return "OK"
    if count > 0:
        return "LOW"
    return "MISSING"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python ml/food/check_dataset.py <dataset-folder>")

    root = Path(sys.argv[1])
    if not root.is_dir():
        sys.exit(f"Folder not found: {root}")

    known = {c["slug"]: c for c in CLASSES}
    counts: dict[str, int] = defaultdict(int)
    problems: list[tuple[str, str]] = []
    seen_hashes: dict[str, Path] = {}

    folders = sorted(p for p in root.iterdir() if p.is_dir())
    unknown = [p.name for p in folders if p.name not in known]

    for folder in folders:
        if folder.name not in known:
            continue
        for path in sorted(folder.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in IMAGE_EXTS:
                problems.append((str(path), "not an image file (skipped)"))
                continue

            digest = hashlib.md5(path.read_bytes()).hexdigest()
            if digest in seen_hashes:
                problems.append((str(path), f"duplicate of {seen_hashes[digest]}"))
                continue
            seen_hashes[digest] = path

            try:
                with Image.open(path) as img:
                    img.verify()
                with Image.open(path) as img:
                    width, height = img.size
            except (UnidentifiedImageError, OSError) as error:
                problems.append((str(path), f"broken image ({error.__class__.__name__})"))
                continue

            if min(width, height) < MIN_SIDE:
                problems.append((str(path), f"too small ({width}x{height})"))
                continue

            counts[folder.name] += 1

    # ---- Report -------------------------------------------------------
    rows = []
    for c in CLASSES:
        n = counts.get(c["slug"], 0)
        rows.append({
            "slug": c["slug"],
            "name": c["name"],
            "group": c["group"],
            "priority": c["priority"],
            "usable_images": n,
            "status": status_for(n),
        })

    print(f"\nDataset: {root}\n")
    print(f"{'Dish':32} {'Pri':>3} {'Images':>7}  Status")
    print("-" * 56)
    for r in sorted(rows, key=lambda r: (r["priority"], r["status"] != "MISSING", r["usable_images"])):
        print(f"{r['name'][:32]:32} {r['priority']:>3} {r['usable_images']:>7}  {r['status']}")

    by_status = defaultdict(int)
    for r in rows:
        by_status[r["status"]] += 1
    trainable = [r for r in rows if r["usable_images"] >= ENOUGH]

    print("-" * 56)
    print(f"Total usable images: {sum(counts.values())}")
    print(
        f"Dishes: {by_status['GOOD']} good (>= {TARGET}), {by_status['OK']} ok (>= {ENOUGH}), "
        f"{by_status['LOW']} low, {by_status['MISSING']} missing"
    )
    print(f"Dishes ready for training (>= {ENOUGH} images): {len(trainable)} of {len(CLASSES)}")

    if unknown:
        print(f"\nFolders that don't match any dish slug (ignored): {', '.join(unknown)}")
        print("Rename them to a slug from ml/food/food_classes.json.")

    if problems:
        print(f"\n{len(problems)} files skipped. First 15:")
        for path, reason in problems[:15]:
            print(f"  {reason}: {path}")

    report = root / "dataset_report.csv"
    with report.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nFull report written to {report}")


if __name__ == "__main__":
    main()
