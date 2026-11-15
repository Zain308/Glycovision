"""
Import photos from a downloaded image dataset (a zip, or an unpacked folder)
into food-dataset folders.

Sources and folder mappings live in zip_sources.json. Each mapped photo is
saved as <dish>/<prefix>_<folder>_<file name>, keeping the original file
name so augmented copies (e.g. 000005_aug1_x.jpg) can be grouped with their
original (000005.jpg) when splitting train/test. With "keep_split": true the
parent folder (train/test/...) is kept in the name too. Re-running skips
existing files. The source is only read.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\import_zip_dataset.py <key> <zip-or-folder> <food-dataset>
"""

import csv
import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def iter_photos(source: Path):
    """(relative path, read function) for every file in a zip or folder."""
    if source.is_dir():
        for path in sorted(source.rglob("*")):
            if path.is_file():
                yield path.relative_to(source).as_posix(), path.read_bytes
        return
    with zipfile.ZipFile(source) as archive:
        for info in archive.infolist():
            if not info.is_dir():
                yield info.filename, (lambda i=info: archive.read(i))


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit("Usage: python ml/food/import_zip_dataset.py <key> <zip-or-folder> <food-dataset>")
    key, source, dataset = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])

    sources = json.loads((HERE / "zip_sources.json").read_text(encoding="utf-8"))["sources"]
    config = next((s for s in sources if s["key"] == key), None)
    if config is None:
        sys.exit(f"{key} is not listed in zip_sources.json")
    if not source.exists():
        sys.exit(f"Zip or folder not found: {source}")
    if not dataset.is_dir():
        sys.exit(f"Dataset folder not found: {dataset}")

    mapping = config["map"]
    # max_per_folder: keep a stable sample of each big source folder (the
    # files whose name hashes lowest), so one dish cannot swamp the upload.
    allowed = None
    cap = config.get("max_per_folder")
    if cap:
        by_folder: dict[str, list[str]] = {}
        for name, _ in iter_photos(source):
            parts = name.replace("\\", "/").split("/")
            if len(parts) >= 2 and parts[-2] in mapping and Path(parts[-1]).suffix.lower() in IMAGE_EXTS:
                by_folder.setdefault(parts[-2], []).append(name)
        allowed = {n for names in by_folder.values()
                   for n in sorted(names, key=lambda n: hashlib.md5(n.encode("utf-8")).hexdigest())[:cap]}

    saved: Counter = Counter()
    skipped_existing = 0
    unmapped: Counter = Counter()
    seen_folders = set()

    for name, read in iter_photos(source):
        parts = name.replace("\\", "/").split("/")
        if len(parts) < 2 or Path(parts[-1]).suffix.lower() not in IMAGE_EXTS:
            continue
        folder = parts[-2]
        seen_folders.add(folder)
        slug = mapping.get(folder)
        if slug is None:
            unmapped[folder] += 1
            continue
        if allowed is not None and name not in allowed:
            continue

        target_dir = dataset / slug
        target_dir.mkdir(exist_ok=True)
        # keep_split: some datasets reuse file names across train/test folders
        middle = f"{parts[-3]}_{folder}" if config.get("keep_split") and len(parts) >= 3 else folder
        target = target_dir / f"{config['prefix']}_{middle}_{parts[-1]}".replace(" ", "_")
        if target.exists():
            skipped_existing += 1
            saved[slug] += 1
            continue
        target.write_bytes(read())
        saved[slug] += 1

    missing = set(mapping) - seen_folders
    if missing:
        print(f"Warning: mapped folders not found: {sorted(missing)}")

    sources_csv = dataset / "sources.csv"
    new_file = not sources_csv.exists()
    with sources_csv.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["folder", "source", "licence", "photos", "notes"])
        for slug, n in sorted(saved.items()):
            note = f"file prefix {config['prefix']}_"
            if config.get("notes"):
                note += f"; {config['notes']}"
            writer.writerow([slug, config["name"], config["licence"], n, note])

    print(f"Imported {sum(saved.values())} photos into {len(saved)} dish folders"
          f" ({skipped_existing} were already there).")
    for slug, n in sorted(saved.items()):
        print(f"  {slug:16} +{n}")
    if unmapped:
        print("Folders not imported (no matching dish):")
        for folder, n in sorted(unmapped.items()):
            print(f"  {folder}: {n}")


if __name__ == "__main__":
    main()
