"""
Find near-duplicate photos inside each dish folder.

Many public food datasets pad each class with flipped, rotated or
re-coloured copies of the same photo. If copies of one photo land in both
the training and the test set, accuracy looks better than it really is.
This finds photos that are the same picture after a flip, a 90/180/270
degree rotation or a brightness change, and keeps one of each group.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\find_near_duplicates.py <food-dataset>          # report only
    .\\venv\\Scripts\\python.exe ml\\food\\find_near_duplicates.py <food-dataset> --move   # move extras aside

With --move, extras go to <food-dataset>-near-duplicates/<dish>/ (nothing is
deleted), so you can look at them and move any back.

Method: difference hash (dHash, 64 bits) of each photo and of its flipped
and rotated versions; two photos match when any pair of hashes differs in
at most MAX_DISTANCE bits. dHash compares neighbouring brightness, so it is
unaffected by overall brightness/contrast changes.
"""

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MAX_DISTANCE = 6  # out of 64 bits; low = only near-identical pictures


def dhash(img: Image.Image) -> int:
    small = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = small.tobytes()  # one byte per pixel in mode "L"
    bits = 0
    for row in range(8):
        for col in range(8):
            left = px[row * 9 + col]
            right = px[row * 9 + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return bits


def variant_hashes(img: Image.Image) -> list[int]:
    """Hashes of the photo as it is, flipped and rotated."""
    variants = [
        img,
        ImageOps.mirror(img),
        ImageOps.flip(img),
        img.rotate(90, expand=True),
        img.rotate(180, expand=True),
        img.rotate(270, expand=True),
    ]
    return [dhash(v) for v in variants]


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    move = "--move" in sys.argv
    if len(args) != 1:
        sys.exit("Usage: python ml/food/find_near_duplicates.py <food-dataset> [--move]")

    root = Path(args[0])
    if not root.is_dir():
        sys.exit(f"Folder not found: {root}")
    aside_root = root.parent / f"{root.name}-near-duplicates"

    total_before = total_extra = 0
    report = []

    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        photos = sorted(
            p for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in IMAGE_EXTS
        )
        if not photos:
            continue

        kept: list[tuple[Path, list[int]]] = []
        extras: list[tuple[Path, Path]] = []

        for path in photos:
            try:
                with Image.open(path) as img:
                    img = ImageOps.exif_transpose(img).convert("RGB")
                    own = dhash(img)
                    variants = variant_hashes(img)
            except OSError:
                continue  # broken files are reported by check_dataset.py

            match = None
            for kept_path, kept_variants in kept:
                if any(bin(own ^ h).count("1") <= MAX_DISTANCE for h in kept_variants):
                    match = kept_path
                    break

            if match is None:
                kept.append((path, variants))
            else:
                extras.append((path, match))

        total_before += len(photos)
        total_extra += len(extras)
        report.append((folder.name, len(photos), len(kept), len(extras)))

        if move and extras:
            target = aside_root / folder.name
            target.mkdir(parents=True, exist_ok=True)
            for path, _ in extras:
                shutil.move(str(path), str(target / path.name))

    print(f"\n{'Dish':18} {'Photos':>7} {'Unique':>7} {'Copies':>7}")
    print("-" * 42)
    for name, before, unique, extra in report:
        print(f"{name:18} {before:>7} {unique:>7} {extra:>7}")
    print("-" * 42)
    print(f"{'Total':18} {total_before:>7} {total_before - total_extra:>7} {total_extra:>7}")

    if move:
        print(f"\nMoved {total_extra} near-duplicates to {aside_root}")
    elif total_extra:
        print("\nReport only. Run again with --move to move the copies aside.")


if __name__ == "__main__":
    main()
