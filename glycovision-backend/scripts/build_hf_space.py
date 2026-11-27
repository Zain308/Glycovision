"""
Assemble the Hugging Face Space folder for the backend.

Copies only what the server needs to run (code, model weights, nutrition
table, Dockerfile, requirements) into <out>, plus the Space README and the
Git LFS rules for large files. Never copies .env, venv, datasets, tests,
tmp uploads or caches.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe scripts\\build_hf_space.py E:\\Glycovision\\deploy\\hf-space
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INCLUDE = [
    "main.py",
    "app.py",
    "core",
    "routers",
    "services",
    "models/__init__.py",
    "models/schemas.py",
    "models/class_names.json",
    "models/pakistani_food_model.pth",
    "models/spike_prediction",
    "models/forecast",
]
SKIP_NAMES = {"__pycache__", ".env", "tmp", "venv", ".pytest_cache"}
SKIP_SUFFIXES = {".pyc", ".csv"}  # spike_prediction CSVs are training reports

# Spike models are shipped as verified compressed copies (free Spaces are
# limited to 1 GB; the originals are ~380 MB each, compressed ~95 MB).
COMPRESSED_MODELS = Path("E:/Glycovision/deploy/spike-compressed")

README = """---
title: GlycoVision API
emoji: 🩸
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 6.25.0
python_version: "3.12"
app_file: app.py
pinned: false
short_description: GlycoVision diabetes app API (research prototype)
---

# GlycoVision API

FastAPI backend for the GlycoVision mobile app: food photo recognition
(70 Pakistani and everyday dishes), nutrition from published tables (INDB,
USDA), research bolus estimate, 60-minute glucose-rise prediction and voice
stress context.

* Health check: `/health`
* API docs: `/docs`
* Every data route needs a GlycoVision (Supabase) login token.

Research prototype for a final-year project. Not a medical device and not
for treatment decisions.
"""

# Space requirements: the backend's pinned list plus PyTorch. ZeroGPU
# hardware needs the standard PyPI build (it manages CUDA itself), and
# Python 3.12. Gradio and `spaces` are installed by the Space itself.
SPACE_REQUIREMENTS_HEADER = """torch==2.13.0
torchvision==0.28.0
"""

# No packages.txt: the Gradio Space image already installs ffmpeg (needed
# for voice checks). A packages.txt written on Windows also got CRLF line
# endings, which apt read as a package named "ffmpeg\r" and failed.

GITATTRIBUTES = """*.pth filter=lfs diff=lfs merge=lfs -text
*.joblib filter=lfs diff=lfs merge=lfs -text
"""


def copy(src: Path, dst: Path) -> int:
    if src.name in SKIP_NAMES or src.suffix in SKIP_SUFFIXES:
        return 0
    if src.suffix == ".joblib" and src.parent.name == "spike_prediction":
        packed = COMPRESSED_MODELS / src.name
        if not packed.exists():
            sys.exit(f"Run scripts/compress_models.py {COMPRESSED_MODELS} first (missing {packed.name})")
        src = packed
    if src.is_dir():
        return sum(copy(child, dst / child.name) for child in src.iterdir())
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return src.stat().st_size


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/build_hf_space.py <out-folder>")
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for rel in INCLUDE:
        src = ROOT / rel
        if not src.exists():
            sys.exit(f"Missing: {src}")
        total += copy(src, out / rel)
    (out / "README.md").write_text(README, encoding="utf-8")
    reqs = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    # The Space installs gradio[mcp,oauth]; its mcp extra requires
    # pydantic >=2.11.10,<=2.12.5, so relax our dev pin (2.13.4) here.
    # Same pydantic 2 API; fastapi needs >=2.9, pydantic-settings >=2.7.
    reqs = reqs.replace("pydantic==2.13.4", "pydantic>=2.11.10,<=2.12.5")
    (out / "requirements.txt").write_text(SPACE_REQUIREMENTS_HEADER + reqs, encoding="utf-8")
    (out / "packages.txt").unlink(missing_ok=True)
    # A Dockerfile left over from an earlier build would switch the Space type.
    (out / "Dockerfile").unlink(missing_ok=True)
    (out / ".gitattributes").write_text(GITATTRIBUTES, encoding="utf-8")
    leaked = [p for p in out.rglob("*") if p.name == ".env" or "venv" in p.parts]
    if leaked:
        sys.exit(f"Refusing: secrets or venv in output: {leaked}")
    if total > 950e6:
        sys.exit(f"Too big for a free Space: {total / 1e6:.0f} MB (limit 1 GB)")
    print(f"Space folder ready: {out} ({total / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
