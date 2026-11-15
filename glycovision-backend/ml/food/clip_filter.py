"""
Remove off-topic photos from web-scraped class folders using CLIP.

Scraped datasets mix in pictures that only share the label's word: rice
fields in "rice", sunsets in "orange", jam jars in "guava". For each photo
CLIP compares it with the 'keep' and 'reject' text prompts in
clip_prompts.json; it is kept when the keep prompts get >= 50% of the
probability. Rejected photos are moved (never deleted) to
<source>-rejected/<same relative path>, so they can be checked and moved back.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\clip_filter.py <source-folder> [--dry-run] [--prompts file.json]

--prompts picks another prompt file (default: clip_prompts.json here).

Every sub-folder whose name has an entry in clip_prompts.json is filtered,
at any depth (e.g. train/rice and test/rice). Others are left alone.
Model: OpenCLIP ViT-B-32 (laion2b), CPU is fine for a few thousand photos.
"""

import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import open_clip
import torch
from PIL import Image

HERE = Path(__file__).resolve().parent
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
KEEP_THRESHOLD = 0.5


def main() -> None:
    prompts_file = HERE / "clip_prompts.json"
    if "--prompts" in sys.argv:
        prompts_file = Path(sys.argv[sys.argv.index("--prompts") + 1])
    args = [a for a in sys.argv[1:] if not a.startswith("--") and Path(a) != prompts_file]
    dry_run = "--dry-run" in sys.argv
    if len(args) != 1:
        sys.exit("Usage: python ml/food/clip_filter.py <source-folder> [--dry-run]")
    root = Path(args[0])
    if not root.is_dir():
        sys.exit(f"Folder not found: {root}")
    rejected_root = root.parent / f"{root.name}-rejected"

    config = json.loads(prompts_file.read_text(encoding="utf-8"))
    generic = config["generic_reject"]

    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model.eval()

    kept: Counter = Counter()
    dropped: Counter = Counter()
    for name, prompts in config["classes"].items():
        folders = [p for p in root.rglob(name) if p.is_dir()]
        if not folders:
            continue
        texts = prompts["keep"] + prompts["reject"] + generic
        n_keep = len(prompts["keep"])
        with torch.no_grad():
            text_feat = model.encode_text(tokenizer([f"a photo of {t}" for t in texts]))
            text_feat /= text_feat.norm(dim=-1, keepdim=True)

        for folder in folders:
            photos = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
            for start in range(0, len(photos), 32):
                batch, paths = [], []
                for path in photos[start:start + 32]:
                    try:
                        batch.append(preprocess(Image.open(path).convert("RGB")))
                        paths.append(path)
                    except OSError:
                        continue
                if not batch:
                    continue
                with torch.no_grad():
                    img_feat = model.encode_image(torch.stack(batch))
                    img_feat /= img_feat.norm(dim=-1, keepdim=True)
                    probs = (100.0 * img_feat @ text_feat.T).softmax(dim=-1)
                for path, p in zip(paths, probs):
                    if p[:n_keep].sum().item() >= KEEP_THRESHOLD:
                        kept[name] += 1
                        continue
                    dropped[name] += 1
                    if not dry_run:
                        target = rejected_root / path.relative_to(root)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(path), str(target))

    print(f"\n{'Folder':14} {'Kept':>6} {'Removed':>8}")
    for name in sorted(set(kept) | set(dropped)):
        print(f"{name:14} {kept[name]:>6} {dropped[name]:>8}")
    if dry_run:
        print("\nDry run: nothing moved.")
    else:
        print(f"\nRemoved photos moved to {rejected_root}")


if __name__ == "__main__":
    main()
