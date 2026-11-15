"""
Write compressed copies of the spike-prediction models for deployment.

The .joblib files were saved uncompressed (~380 MB each), which does not
fit a free Hugging Face Space (1 GB limit). joblib can store the same
object compressed; loading is unchanged (joblib.load detects it).

Each copy is verified: every tree is compared array by array, and
predictions on 5,000 random inputs must be exactly equal, computed with
one thread. (joblib.hash differs even between two loads of the same file,
and multi-threaded predict_proba adds tree votes in a random order, so the
original does not exactly match itself with n_jobs > 1.)

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe scripts\\compress_models.py <out-dir>
"""

import sys
import time
from pathlib import Path

import joblib
import numpy as np

SRC = Path(__file__).resolve().parents[1] / "models" / "spike_prediction"


def same_model(a, b) -> bool:
    """Exact equality: same trees (all arrays) and identical predictions."""
    if type(a) is not type(b) or getattr(a, "n_features_in_", None) != getattr(b, "n_features_in_", None):
        return False
    for ta, tb in zip(getattr(a, "estimators_", []), getattr(b, "estimators_", [])):
        for field in ("feature", "threshold", "children_left", "children_right", "value"):
            if not np.array_equal(getattr(ta.tree_, field), getattr(tb.tree_, field)):
                return False
    rng = np.random.default_rng(0)
    X = rng.normal(0, 50, size=(5000, a.n_features_in_)) + 120
    saved = (a.n_jobs, b.n_jobs, a.verbose, b.verbose)
    a.n_jobs = b.n_jobs = 1
    a.verbose = b.verbose = 0
    try:
        return bool(np.array_equal(a.predict_proba(X), b.predict_proba(X)))
    finally:
        a.n_jobs, b.n_jobs, a.verbose, b.verbose = saved


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/compress_models.py <out-dir>")
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for src in sorted(SRC.glob("*.joblib")):
        dst = out / src.name
        t0 = time.time()
        model = joblib.load(src)
        joblib.dump(model, dst, compress=("zlib", 6))
        if not same_model(model, joblib.load(dst)):
            dst.unlink()
            sys.exit(f"Mismatch after compressing {src.name}; copy removed")
        print(f"{src.name}: {src.stat().st_size / 1e6:.0f} MB -> {dst.stat().st_size / 1e6:.0f} MB "
              f"(identical, {time.time() - t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
