"""
Import photos from a Hugging Face image dataset into food-dataset folders.

Sources and label mappings live in hf_sources.json. Each mapped photo is
saved as <dish>/<prefix>_<split>_<index>.jpg and counted in sources.csv.
Labels not in the mapping are skipped. Re-running skips existing files.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\import_hf_dataset.py <repo> <food-dataset> [--max-per-dish N]

Downloads are cached in HF_HOME (set it to a folder on E: to spare C:).
"""

import csv
import io
import json
import sys
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq
from huggingface_hub import HfApi, hf_hub_download
from PIL import Image

HERE = Path(__file__).resolve().parent


def label_names(repo: str) -> list[str]:
    """Class names, from dataset_infos.json or the README's label block."""
    import re

    try:
        path = hf_hub_download(repo, "dataset_infos.json", repo_type="dataset")
        info = json.loads(Path(path).read_text(encoding="utf-8"))
        for cfg in info.values():
            return cfg["features"]["label"]["names"]
    except Exception:
        pass

    readme = Path(hf_hub_download(repo, "README.md", repo_type="dataset")).read_text(encoding="utf-8")
    found = re.findall(r"^\s+'?(\d+)'?: (.+)$", readme, re.M)
    if not found:
        raise RuntimeError(f"Could not find label names for {repo}")
    return [name.strip().strip("'\"") for _, name in sorted(found, key=lambda x: int(x[0]))]


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    max_per_dish = None
    if "--max-per-dish" in sys.argv:
        max_per_dish = int(sys.argv[sys.argv.index("--max-per-dish") + 1])
        args = [a for a in args if a != str(max_per_dish)]
    if len(args) != 2:
        sys.exit("Usage: python ml/food/import_hf_dataset.py <repo> <food-dataset> [--max-per-dish N]")

    repo, dataset = args[0], Path(args[1])
    config = next(
        (s for s in json.loads((HERE / "hf_sources.json").read_text(encoding="utf-8"))["sources"] if s["repo"] == repo),
        None,
    )
    if config is None:
        sys.exit(f"{repo} is not listed in hf_sources.json")
    if not dataset.is_dir():
        sys.exit(f"Dataset folder not found: {dataset}")

    names = label_names(repo)
    wanted = {i: config["map"][n] for i, n in enumerate(names) if n in config["map"]}
    missing = set(config["map"]) - set(names)
    if missing:
        print(f"Warning: mapped labels not found in {repo}: {sorted(missing)}")

    files = [
        f for f in HfApi().list_repo_files(repo, repo_type="dataset")
        if f.endswith(".parquet")
    ]
    print(f"{repo}: {len(names)} labels, importing {len(wanted)}, {len(files)} parquet files")

    saved: Counter = Counter()
    for file in sorted(files):
        split = Path(file).stem.split("-")[0]
        local = hf_hub_download(repo, file, repo_type="dataset")
        table = pq.ParquetFile(local)
        # schema_arrow lists top-level columns ("image", "label");
        # .schema would list nested leaves such as "bytes" and "path".
        top_level = table.schema_arrow.names
        image_col = "image" if "image" in top_level else top_level[0]
        row = 0
        for batch in table.iter_batches(batch_size=256, columns=[image_col, "label"]):
            for image, label in zip(batch.column(image_col).to_pylist(), batch.column("label").to_pylist()):
                row += 1
                slug = wanted.get(label)
                if slug is None:
                    continue
                if max_per_dish and saved[slug] >= max_per_dish:
                    continue
                target = dataset / slug / f"{config['prefix']}_{split}_{row:06d}.jpg"
                if target.exists():
                    saved[slug] += 1
                    continue
                target.parent.mkdir(exist_ok=True)
                try:
                    img = Image.open(io.BytesIO(image["bytes"])).convert("RGB")
                except Exception:
                    continue
                img.save(target, "JPEG", quality=92)
                saved[slug] += 1
        print(f"  {file}: done")

    sources = dataset / "sources.csv"
    new_file = not sources.exists()
    with sources.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["folder", "source", "licence", "photos", "notes"])
        for slug, n in sorted(saved.items()):
            writer.writerow([slug, f"Hugging Face: {repo}", config["licence"], n, f"file prefix {config['prefix']}_"])

    print(f"Imported {sum(saved.values())} photos:")
    for slug, n in sorted(saved.items()):
        print(f"  {slug:16} +{n}")


if __name__ == "__main__":
    main()
