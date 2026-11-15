"""
Turn train_food_kaggle.py (cells marked with "# %%") into a Jupyter notebook
for Kaggle: train_food_kaggle.ipynb next to it.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe ml\\food\\make_notebook.py
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
source = (HERE / "train_food_kaggle.py").read_text(encoding="utf-8").replace("\r\n", "\n")

cells = []
for chunk in re.split(r"^# %%", source, flags=re.M)[1:]:
    header, _, body = chunk.partition("\n")
    if header.strip() == "[markdown]":
        text = "\n".join(line[2:] if line.startswith("# ") else line.lstrip("#") for line in body.strip().split("\n"))
        cells.append({"cell_type": "markdown", "metadata": {}, "source": text.splitlines(keepends=True)})
    else:
        cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
                      "source": body.strip("\n").splitlines(keepends=True)})

notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
out = HERE / "train_food_kaggle.ipynb"
out.write_text(json.dumps(notebook, indent=1) + "\n", encoding="utf-8")
print(f"Wrote {out} ({len(cells)} cells)")
