"""
Real food model (not mocked): the installed weights load, match the class
list, recognise a known test photo, and handle sideways phone photos.
Skipped if the upload folder with test photos is not on this machine.
"""

import csv
from pathlib import Path

import pytest
from PIL import Image

DATA = Path("E:/Glycovision/kaggle-upload/glycovision-food")
pytestmark = pytest.mark.skipif(not (DATA / "manifest.csv").exists(), reason="test photos not available")


@pytest.fixture(scope="module")
def clf():
    from services.food_classifier import get_food_classifier
    return get_food_classifier()


def _test_photo(label):
    with (DATA / "manifest.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["label"] == label and r["split"] == "test" and (DATA / r["path"]).exists():
                return DATA / r["path"]
    pytest.skip(f"no test photo for {label}")


def test_weights_match_class_list(clf):
    out = clf.model.get_classifier().out_features
    assert out == len(clf.class_names) and "not_food" in clf.class_names


def test_predict_shape_and_ranges(clf):
    r = clf.predict(str(_test_photo("biryani")))
    assert len(r["top_predictions"]) == 3
    assert all(0 <= p["confidence"] <= 1 for p in r["top_predictions"])
    confs = [p["confidence"] for p in r["top_predictions"]]
    assert confs == sorted(confs, reverse=True)


@pytest.mark.parametrize("dish", ["biryani", "jalebi", "chai", "samosa"])
def test_recognises_known_dishes(clf, dish):
    r = clf.predict(str(_test_photo(dish)))
    assert dish in [p["food_name"] for p in r["top_predictions"]]


def test_sideways_phone_photo(clf, tmp_path):
    """A photo saved rotated with an EXIF flag must give the same answer."""
    src = Image.open(_test_photo("jalebi")).convert("RGB")
    upright = clf.predict(str(_test_photo("jalebi")))["top_predictions"][0]["food_name"]
    rotated = src.rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 8  # orientation: rotate 90 CW to display
    path = tmp_path / "sideways.jpg"
    rotated.save(path, exif=exif)
    assert clf.predict(str(path))["top_predictions"][0]["food_name"] == upright


def test_missing_file_raises(clf):
    with pytest.raises(FileNotFoundError):
        clf.predict("does/not/exist.jpg")
