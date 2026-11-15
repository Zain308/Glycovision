"""
Group photos that are versions of the same picture, for a leak-free split.

Some datasets pad each dish with cropped, rotated or re-coloured copies of
one photo. find_near_duplicates.py catches exact flips and rotations, but not
crops or small rotations. If two versions of one photo end up in train and
test, the test score is too high. This embeds every photo with CLIP; within
each dish, a photo from a source that pads with copies (GROUP_PREFIXES) joins
the first earlier group whose leading photo has cosine similarity >=
THRESHOLD, otherwise it starts a new group. prepare_kaggle_upload.py then
puts each whole group in one split.

THRESHOLD 0.85 was picked by looking at nihari pairs: from about 0.86 up,
pairs were nearly always the same picture re-cropped or re-coloured.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\group_similar.py <food-dataset>

Writes <food-dataset>/groups.csv (dish, file, group). Embeddings are cached
in <food-dataset>/.clip_cache/<dish>.npz, so re-runs only embed new photos.
"""

import csv
import sys
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
THRESHOLD = 0.85
# Only these sources pad dishes with edited copies; photos from the other
# sources (Food-101 etc.) are distinct and each forms its own group.
GROUP_PREFIXES = ("smf_", "zipA_", "zipB_")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python ml/food/group_similar.py <food-dataset>")
    root = Path(sys.argv[1])
    cache_dir = root / ".clip_cache"
    cache_dir.mkdir(exist_ok=True)

    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    model.eval()
    torch.set_num_threads(max(1, torch.get_num_threads()))

    rows = []
    multi_groups = grouped_photos = 0
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")):
        files = sorted(p.name for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
        if not files:
            continue
        cache_file = cache_dir / f"{folder.name}.npz"
        cached = {}
        if cache_file.exists():
            data = np.load(cache_file, allow_pickle=False)
            cached = dict(zip(data["names"].tolist(), data["emb"]))

        todo = [f for f in files if f not in cached]
        for start in range(0, len(todo), 64):
            batch, names = [], []
            for name in todo[start:start + 64]:
                try:
                    batch.append(preprocess(Image.open(folder / name).convert("RGB")))
                    names.append(name)
                except OSError:
                    continue
            if batch:
                with torch.no_grad():
                    emb = model.encode_image(torch.stack(batch)).float()
                    emb = (emb / emb.norm(dim=-1, keepdim=True)).numpy().astype(np.float16)
                cached.update(zip(names, emb))
        names = [f for f in files if f in cached]
        if todo:
            np.savez(cache_file, names=np.array(names), emb=np.stack([cached[n] for n in names]))

        emb = np.stack([cached[n] for n in names]).astype(np.float32)
        # Leader grouping: a photo joins a group only if it is close to that
        # group's first photo. (Linking any close pair chained whole dishes of
        # look-alike photos, e.g. 1,000 French fries, into one group.)
        roots = list(range(len(names)))
        leaders: list[int] = []
        for i, name in enumerate(names):
            if not name.startswith(GROUP_PREFIXES):
                continue
            if leaders:
                sims = emb[leaders] @ emb[i]
                best = int(np.argmax(sims))
                if sims[best] >= THRESHOLD:
                    roots[i] = leaders[best]
                    continue
            leaders.append(i)
        sizes = np.bincount(roots, minlength=len(names))
        multi_groups += int(np.sum(sizes > 1))
        grouped_photos += int(sum(sizes[r] > 1 for r in roots))
        for name, r in zip(names, roots):
            rows.append((folder.name, name, f"{folder.name}/{names[r]}"))
        print(f"{folder.name:16} {len(names):5} photos, {len(set(roots)):5} groups, largest {sizes.max()}", flush=True)

    with (root / "groups.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["dish", "file", "group"])
        writer.writerows(rows)
    print(f"\n{len(rows)} photos; {grouped_photos} sit in {multi_groups} groups of 2+ versions of one picture.")
    print(f"Written {root / 'groups.csv'}")


if __name__ == "__main__":
    main()
