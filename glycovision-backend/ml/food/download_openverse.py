"""
Download Creative Commons food photos from Openverse (api.openverse.org),
for dishes that no Kaggle / Hugging Face dataset covers.

Openverse indexes openly licensed photos (mostly Flickr). Every saved photo
gets a row in <out>/attribution.csv (creator, licence, source page), which
CC BY / BY-SA licences require. Photos are web search results and can be
off-topic, so run clip_filter.py on <out> before importing.

Queries per dish live in openverse_queries.json. Anonymous use is limited
(about 240 results per query, a few requests per minute), so the script
waits between requests and backs off on HTTP 429.

Usage (from glycovision-backend):
    .\\venv\\Scripts\\python.exe -I ml\\food\\download_openverse.py <out-folder> [dish ...]
Then:
    ml\\food\\clip_filter.py <out-folder> --prompts ml\\food\\openverse_prompts.json
    ml\\food\\import_zip_dataset.py openverse <out-folder> <food-dataset>
"""

import csv
import json
import sys
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
API = "https://api.openverse.org/v1/images/"
HEADERS = {"User-Agent": "GlycoVisionDatasetBuilder/0.1 (student research project)"}
PAGE_SIZE = 20          # the anonymous maximum
MAX_PAGES = 12          # anonymous searches stop at about 240 results
MIN_SHORT_SIDE = 160    # same rule as check_dataset.py
API_PAUSE = 4.0         # seconds between API calls


def api_get(params: dict) -> dict | None:
    for attempt in range(5):
        try:
            r = requests.get(API, params=params, headers=HEADERS, timeout=60)
        except requests.RequestException:
            time.sleep(10 * (attempt + 1))
            continue
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 60))
            print(f"  rate limited, waiting {wait}s", flush=True)
            time.sleep(wait)
            continue
        if r.ok:
            return r.json()
        print(f"  API error {r.status_code} for {params.get('q')} page {params.get('page')}: {r.text[:120]}", flush=True)
        return None
    return None


def fetch_image(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if not r.ok or len(r.content) < 5000:
            return None
        with Image.open(BytesIO(r.content)) as img:
            if min(img.size) < MIN_SHORT_SIDE:
                return None
            img.verify()
        return r.content
    except Exception:
        return None


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: python -I ml/food/download_openverse.py <out-folder> [dish ...]")
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    queries: dict[str, list[str]] = json.loads((HERE / "openverse_queries.json").read_text(encoding="utf-8"))["dishes"]
    wanted = sys.argv[2:] or list(queries)

    attribution = out / "attribution.csv"
    seen_ids = set()
    if attribution.exists():
        with attribution.open(encoding="utf-8") as f:
            seen_ids = {row["id"] for row in csv.DictReader(f)}
    new_file = not attribution.exists()
    with attribution.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["id", "dish", "file", "title", "creator", "license", "license_version", "source_page", "query"])
        for dish in wanted:
            folder = out / dish
            folder.mkdir(exist_ok=True)
            saved = 0
            for query in queries[dish]:
                for page in range(1, MAX_PAGES + 1):
                    data = api_get({"q": query, "page_size": PAGE_SIZE, "page": page, "mature": "false"})
                    time.sleep(API_PAUSE)
                    if not data or not data.get("results"):
                        break
                    for item in data["results"]:
                        if item["id"] in seen_ids:
                            continue
                        seen_ids.add(item["id"])
                        content = fetch_image(item.get("url", ""))
                        if content is None:
                            continue
                        name = f"{item['id']}.jpg"
                        (folder / name).write_bytes(content)
                        writer.writerow([item["id"], dish, name, item.get("title", ""), item.get("creator", ""),
                                         item.get("license", ""), item.get("license_version", ""),
                                         item.get("foreign_landing_url", ""), query])
                        saved += 1
                    f.flush()
                    if page >= data.get("page_count", 0):
                        break
            print(f"{dish:16} +{saved}", flush=True)


if __name__ == "__main__":
    main()
