"""
Medicines the patient was prescribed: today's list and how many were taken.

GlycoVision never suggests a medicine, a dose or a change. It repeats what
the patient typed in from their prescription.
"""

from datetime import date, datetime, timedelta

ADHERENCE_DAYS = 7
DUE_SOON_MIN = 30          # shown as due this long before the time
LATE_MIN = 120             # after this it is called missed


def parse_hhmm(value: str) -> int:
    """Minutes after midnight."""
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def dose_state(time: str, now_min: int, status: str | None) -> str:
    """taken, skipped, missed, due or later."""
    if status in ("taken", "skipped"):
        return status
    at = parse_hhmm(time)
    if now_min > at + LATE_MIN:
        return "missed"
    return "due" if now_min >= at - DUE_SOON_MIN else "later"


def today_list(medicines: list[dict], logs: list[dict], now_local: datetime) -> list[dict]:
    """Every dose of today in time order."""
    today = now_local.date().isoformat()
    status = {(r["medicine_id"], str(r["day"])[:10], r["time"]): r["status"] for r in logs}
    now_min = now_local.hour * 60 + now_local.minute
    out = []
    for m in medicines:
        if not m.get("active", True):
            continue
        for t in m.get("times") or []:
            out.append({
                "medicine_id": m["id"], "name": m["name"], "dose": m.get("dose"), "time": t,
                "state": dose_state(t, now_min, status.get((m["id"], today, t))),
            })
    return sorted(out, key=lambda d: (parse_hhmm(d["time"]), d["name"].lower()))


def adherence(medicines: list[dict], logs: list[dict], today: date, tz) -> dict:
    """
    Doses taken of doses planned, over the last 7 full days (today is not
    over). A medicine counts only from the day after it was added.
    """
    taken = {(r["medicine_id"], str(r["day"])[:10], r["time"]) for r in logs if r["status"] == "taken"}
    planned = done = 0
    for m in medicines:
        if not m.get("active", True):
            continue
        created = m.get("created_at")
        added = datetime.fromisoformat(str(created).replace("Z", "+00:00")).astimezone(tz).date() if created else None
        for back in range(1, ADHERENCE_DAYS + 1):
            day = today - timedelta(days=back)
            if added and day <= added:
                continue
            for t in m.get("times") or []:
                planned += 1
                done += (m["id"], day.isoformat(), t) in taken
    return {"taken": done, "planned": planned, "percent": round(100 * done / planned) if planned else None, "days": ADHERENCE_DAYS}
