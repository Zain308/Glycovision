"""
Build a small, upload-ready copy of food-dataset for training on Kaggle.

What it does:
  * keeps dishes that have at least --min-photos usable photos (default 150)
  * skips broken photos and photos whose short side is under 160 px
    (same rules as check_dataset.py)
  * resizes each photo so its short side is 256 px (JPEG quality 90), which
    makes the upload roughly ten times smaller with no loss at 224 px input
  * assigns every photo to train / val / test (80 / 10 / 10), stable across
    runs (hash of the file name)
  * versions of one picture stay together: if group_similar.py has written
    groups.csv, each whole group goes to one split (no train/test leak);
    zipB_ files (augmented, with artificial borders) are always train
  * writes manifest.csv, class_names.json and dataset-metadata.json (private
    Kaggle dataset) next to the images

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\prepare_kaggle_upload.py <food-dataset> <out-folder> [--min-photos 150] [--kaggle-user NAME]

Then upload (creates a PRIVATE dataset on your Kaggle account):
    .\\venv\\Scripts\\kaggle datasets create -p <out-folder> --dir-mode zip
For a later update:
    .\\venv\\Scripts\\kaggle datasets version -p <out-folder> -m "more photos" --dir-mode zip
"""

import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MIN_SHORT_SIDE = 160
TARGET_SHORT_SIDE = 256
TRAIN_ONLY_PREFIXES = ("zipB_",)


def load_groups(src: Path) -> dict[tuple[str, str], str]:
    """(dish, file) -> group id from group_similar.py, if it has been run."""
    path = src / "groups.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return {(r["dish"], r["file"]): r["group"] for r in csv.DictReader(f)}


def split_for(dish: str, name: str, groups: dict) -> str:
    # zipB_ photos carry artificial borders from augmentation: never test on them.
    if name.startswith(TRAIN_ONLY_PREFIXES):
        return "train"
    if groups:
        # Every version of one picture shares a group, so the group decides the split.
        key = groups.get((dish, name), f"{dish}/{name}")
    else:
        # No groups.csv: fall back to keeping files marked as augmented out of val/test.
        if "_aug" in name.lower():
            return "train"
        key = name
    bucket = int(hashlib.md5(key.encode("utf-8")).hexdigest(), 16) % 10
    return "test" if bucket == 0 else "val" if bucket == 1 else "train"


def arg_value(flag: str, default: str | None) -> str | None:
    if flag in sys.argv:
        return sys.argv[sys.argv.index(flag) + 1]
    return default


def main() -> None:
    min_photos = int(arg_value("--min-photos", "150"))
    kaggle_user = arg_value("--kaggle-user", None)
    flag_values = {str(min_photos), kaggle_user}
    args = [a for a in sys.argv[1:] if not a.startswith("--") and a not in flag_values]
    if len(args) != 2:
        sys.exit("Usage: python ml/food/prepare_kaggle_upload.py <food-dataset> <out-folder> "
                 "[--min-photos 150] [--kaggle-user NAME]")
    src, out = Path(args[0]), Path(args[1])
    if not src.is_dir():
        sys.exit(f"Folder not found: {src}")

    # Pass 1: find usable photos per dish.
    usable: dict[str, list[Path]] = {}
    for folder in sorted(p for p in src.iterdir() if p.is_dir()):
        good = []
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() not in IMAGE_EXTS:
                continue
            try:
                with Image.open(path) as img:
                    if min(img.size) >= MIN_SHORT_SIDE:
                        good.append(path)
            except OSError:
                continue
        usable[folder.name] = good

    classes = sorted(k for k, v in usable.items() if len(v) >= min_photos)
    left_out = sorted(k for k, v in usable.items() if 0 < len(v) < min_photos)
    print(f"{len(classes)} dishes included, {len(left_out)} left out (< {min_photos} photos): {', '.join(left_out)}")

    groups = load_groups(src)
    print("Splitting by picture group (groups.csv)" if groups
          else "No groups.csv: run group_similar.py first for a leak-free split")

    # Pass 2: resize, copy, record split.
    images_dir = out / "images"
    rows = []
    counts: Counter = Counter()
    for slug in classes:
        (images_dir / slug).mkdir(parents=True, exist_ok=True)
        for path in usable[slug]:
            target = images_dir / slug / (path.stem + ".jpg")
            if not target.exists():
                try:
                    with Image.open(path) as img:
                        img = ImageOps.exif_transpose(img).convert("RGB")
                        scale = TARGET_SHORT_SIDE / min(img.size)
                        if scale < 1:
                            img = img.resize((round(img.width * scale), round(img.height * scale)),
                                             Image.Resampling.LANCZOS)
                        img.save(target, "JPEG", quality=90)
                except OSError:
                    continue
            split = split_for(slug, path.name, groups)
            source = path.name.split("_", 1)[0]
            rows.append((f"images/{slug}/{target.name}", slug, split, source))
            counts[(slug, split)] += 1

    with (out / "manifest.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["path", "label", "split", "source"])
        writer.writerows(rows)
    (out / "class_names.json").write_text(json.dumps(classes, indent=2) + "\n", encoding="utf-8")

    if kaggle_user:
        meta = {
            "title": "GlycoVision Food Photos",
            "id": f"{kaggle_user}/glycovision-food",
            "licenses": [{"name": "other"}],
            "isPrivate": True,
        }
        (out / "dataset-metadata.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    totals = Counter(split for _, _, split, _ in rows)
    size_mb = sum(p.stat().st_size for p in images_dir.rglob("*.jpg")) / 1e6
    print(f"{len(rows)} photos: train {totals['train']}, val {totals['val']}, test {totals['test']}; {size_mb:.0f} MB")
    thin = [s for s in classes if counts[(s, "test")] < 10]
    if thin:
        print(f"Dishes with fewer than 10 test photos (scores for these are rough): {', '.join(thin)}")
    if groups:
        distinct = Counter(groups.get((s, Path(p).name), p) for p, s, _, _ in rows)
        per_dish = Counter(g.split("/", 1)[0] for g in distinct)
        few = sorted((n, s) for s, n in per_dish.items() if n < 80)
        if few:
            print("Dishes with under 80 distinct pictures (the rest are versions of the same picture):")
            print("  " + ", ".join(f"{s} {n}" for n, s in few))
    print(f"Written to {out}")


if __name__ == "__main__":
    main()
