"""
Fitness from phone and watch data: steps, Move Minutes, Heart Points, sitting
time, an "are you active?" verdict and what activity does to the sugar.
Pure functions; database work is in services/fitness_store.py.

Rules and where they come from
------------------------------
* Move Minute: a minute with 30 or more steps (Google Fit).
* Heart Points: 1 for a moderate minute, 2 for a vigorous one (Google Fit).
  Moderate is 100 steps a minute and vigorous 130 (CADENCE-Adults studies);
  at 61 and over 130 was not supported, so only 1 point is given by steps.
  By heart rate: 50 to 69 % of maximum = 1, 70 % or more = 2 (Google Fit),
  but only while moving: a fast heart at rest may be stress, not exercise.
* 150 Heart Points a week: the WHO, AHA and ADA advice of 150 minutes of
  moderate activity.
* Not more than 2 days in a row without activity, and a break from sitting
  every 30 minutes (American Diabetes Association position statement on
  physical activity, Colberg et al., Diabetes Care 2016).
* Under 5,000 steps a day is a sedentary lifestyle, 10,000 or more is active
  (Tudor-Locke & Bassett 2004). It is a convention, not a medical limit.
"""

from datetime import date, datetime, timedelta, timezone
from statistics import mean, median

BUCKET = timedelta(minutes=5)
STEP_GOAL = 8000
HEART_GOAL = 150
WALK_CADENCE = 90            # used only when minute data is missing
MOVING_STEPS_5M = 100        # moving enough for heart rate to count as exercise
STIR_STEPS_5M = 25           # this many steps in 5 minutes ends a sitting stretch
ACTIVE_HOUR_STEPS = 250
WAKE, SLEEP = 8, 22          # sitting is judged only between these hours
ACTIVE_DAY_POINTS = 20
MAX_QUIET_DAYS = 2

# Compendium of Physical Activities METs, rounded. Unknown activities: 3.
MET = {
    "walking": 3.3, "stretching": 2.3, "cycling": 5.0, "running": 8.0, "housework": 3.0, "sports": 5.0,
    "yoga": 2.5, "strength": 3.5, "swimming": 5.8, "cricket": 4.8, "football": 7.0, "badminton": 5.5,
    "stairs": 4.0, "dancing": 4.8, "hiking": 5.3, "workout": 4.0,
}


def met_of(activity: str) -> float:
    return MET.get((activity or "").strip().lower(), 3.0)


def points_per_minute(met: float) -> int:
    return 2 if met >= 6 else 1 if met >= 3 else 0


def max_heart_rate(age: int | None) -> float | None:
    return 220 - age if age else None


def stride_m(height_cm) -> float:
    """Step length is about 0.414 of height; 0.70 m when height is unknown."""
    return 0.00414 * float(height_cm) if height_cm else 0.70


def bucket_activity(steps: float, hr: float | None, age: int | None, move=None, cadence_points=None) -> tuple[float, float]:
    """(Move Minutes, Heart Points) in one 5-minute bucket."""
    if move is None:
        move = min(5.0, steps / WALK_CADENCE) if steps >= 30 else 0.0
    if cadence_points is None:
        per_minute = steps / 5
        cadence_points = 10 if per_minute >= 130 else 5 if per_minute >= 100 else 0
    if age is not None and age > 60:
        cadence_points = min(cadence_points, 5)
    by_heart = 0
    top = max_heart_rate(age)
    if hr and top and steps >= MOVING_STEPS_5M:
        by_heart = 10 if hr >= 0.7 * top else 5 if hr >= 0.5 * top else 0
    return min(5.0, float(move)), min(10.0, float(max(cadence_points, by_heart)))


def _overlap_steps(steps: dict, start: datetime, end: datetime) -> float:
    return sum(v for t, v in steps.items() if t + BUCKET > start and t < end)


def day_metrics(samples: dict, sessions: list[dict], day_start: datetime, day_end: datetime, *,
                age=None, weight_kg=None, height_cm=None, now: datetime | None = None) -> dict:
    """
    samples: {kind: {bucket start (UTC): value}}
    sessions: [{'activity', 'start', 'end', 'kcal', 'distance_m'}], typed in,
              tracked live, or recorded by a watch.
    """
    now = now or day_end
    steps, hr = samples.get("steps", {}), samples.get("heart_rate", {})
    has_steps = bool(steps)
    hourly = [0.0] * 24
    move = points = 0.0
    for t, n in steps.items():
        m, p = bucket_activity(
            n, hr.get(t), age,
            samples["move_min"].get(t, 0.0) if samples.get("move_min") else None,
            samples["heart_pts"].get(t, 0.0) if samples.get("heart_pts") else None)
        move += m
        points += p
        hour = int((t - day_start).total_seconds() // 3600)
        if 0 <= hour < 24:
            hourly[hour] += n

    # A watch and the phone may both record one workout: longest first, and
    # each minute counts once.
    extra_kcal = extra_m = 0.0
    used: list[tuple[datetime, datetime]] = []
    for s in sorted(sessions, key=lambda s: s["end"] - s["start"], reverse=True):
        start, end = max(s["start"], day_start), min(s["end"], day_end)
        if end <= start or any(a < end and start < b for a, b in used):
            continue
        used.append((start, end))
        minutes = (end - start).total_seconds() / 60
        met = met_of(s["activity"])
        # Walking is already in the steps. Cycling or swimming is not.
        if _overlap_steps(steps, start, end) >= minutes * 30:
            continue
        move += minutes
        points += minutes * points_per_minute(met)
        extra_kcal += s.get("kcal") or (met * float(weight_kg) * minutes / 60 if weight_kg else 0)
        extra_m += s.get("distance_m") or 0

    total = sum(steps.values())
    distance = sum(samples.get("distance_m", {}).values())
    kcal = sum(samples.get("active_kcal", {}).values())
    distance_est = not samples.get("distance_m")
    kcal_est = not samples.get("active_kcal")
    if distance_est:
        distance = total * stride_m(height_cm)
    if kcal_est:
        # Walking at about 3.3 METs, one of which is resting.
        kcal = 2.3 * float(weight_kg) * min(move, total / WALK_CADENCE) / 60 if weight_kg else 0
    has_any = has_steps or bool(used)
    beats = sorted(hr.values())
    still = [v for t, v in hr.items() if steps.get(t, 0) <= 20]
    return {
        "steps": round(total) if has_steps else None,
        "distance_m": round(distance + extra_m) if has_any else None, "distance_estimated": distance_est,
        "active_kcal": round(kcal + extra_kcal) if has_any else None, "kcal_estimated": kcal_est,
        "move_min": round(move) if has_any else None,
        "heart_pts": round(points) if has_any else None,
        "active_hours": sum(1 for h in hourly if h >= ACTIVE_HOUR_STEPS) if has_steps else None,
        "hourly": [round(h) for h in hourly],
        "longest_sit_min": longest_sit(steps, day_start, min(now, day_end)) if has_steps else None,
        "hr_min": round(beats[0]) if beats else None, "hr_max": round(beats[-1]) if beats else None,
        "hr_resting": round(median(still)) if len(still) >= 6 else None,
    }


def _stirs(steps: dict) -> list[datetime]:
    return sorted(t for t, v in steps.items() if v >= STIR_STEPS_5M)


def longest_sit(steps: dict, day_start: datetime, until: datetime) -> int:
    """Longest stretch without moving between 8:00 and 22:00, in minutes."""
    start, end = day_start + timedelta(hours=WAKE), min(until, day_start + timedelta(hours=SLEEP))
    if end <= start:
        return 0
    last, longest = start, timedelta(0)
    for t in _stirs(steps):
        if t >= end:
            break
        if t > last:
            longest = max(longest, t - last)
        last = max(last, t + BUCKET)
    longest = max(longest, end - last)
    return round(longest.total_seconds() / 60)


def sitting_now(steps: dict, day_start: datetime, now: datetime, last_sync: datetime | None) -> int | None:
    """Minutes since the last movement; None when it can't be known."""
    if not steps or last_sync is None or now - last_sync > timedelta(minutes=45):
        return None
    start = day_start + timedelta(hours=WAKE)
    if not start <= now <= day_start + timedelta(hours=SLEEP):
        return None
    stirs = _stirs(steps)
    since = max(start, stirs[-1] + BUCKET) if stirs else start
    return max(0, round((now - since).total_seconds() / 60))


# ------------------------------------------------------------- verdicts

def day_status(today: dict, hour: float, step_goal: int, sitting: int | None) -> dict:
    steps = today.get("steps")
    points = today.get("heart_pts") or 0
    if steps is None and not today.get("move_min"):
        return {"level": "unknown", "title": "No activity data yet",
                "text": "Connect your phone's step counter, track a walk, or add an activity."}
    expected = step_goal * min(1.0, max(0.0, (hour - WAKE) / (SLEEP - 1 - WAKE)))
    if (steps or 0) >= step_goal or points >= 30:
        level, title = "active", "You're active today"
        text = "You reached your goal. Keep breaking up long sitting."
    elif expected < 800:
        level, title, text = "early", "The day is just starting", "A short walk after breakfast is a good start."
    elif (steps or 0) >= expected * 0.85 or points >= 20:
        level, title = "on_track", "You're on track"
        text = f"Keep this pace to reach {step_goal:,} steps."
    elif (steps or 0) >= expected * 0.5 or points >= 10:
        level, title = "low", "Moving a little"
        text = f"About {max(0, round((expected - (steps or 0)) / 100) * 100):,} steps behind your goal's pace. A 15-minute walk helps."
    else:
        level, title = "sitting", "Mostly sitting today"
        text = "Very few steps so far. If your phone was with you, stand up and walk for 5 minutes now."
    if sitting is not None and sitting >= 60:
        text += f" You've been still for {human_minutes(sitting)}."
    return {"level": level, "title": title, "text": text}


def human_minutes(m: int) -> str:
    h, r = divmod(int(m), 60)
    return f"{h} h {r} min" if h and r else f"{h} h" if h else f"{r} min"


def week_status(days: list[dict], heart_goal: int, today: date) -> dict:
    """days: rows with 'day' (date), 'heart_pts', 'steps'."""
    week = [d for d in days if timedelta(0) <= today - d["day"] < timedelta(days=7)]
    known = [d for d in week if d.get("heart_pts") is not None or d.get("steps") is not None]
    points = sum(d.get("heart_pts") or 0 for d in week)
    active = [d for d in known if (d.get("heart_pts") or 0) >= ACTIVE_DAY_POINTS]
    # Full days in a row without activity, up to yesterday: today is not over.
    by_day, quiet = {d["day"]: d for d in known}, 0
    while (d := by_day.get(today - timedelta(days=quiet + 1))) and (d.get("heart_pts") or 0) < ACTIVE_DAY_POINTS:
        quiet += 1
    if by_day.get(today) in active:
        quiet = 0
    base = {"heart_pts": points, "goal": heart_goal, "active_days": len(active), "days_known": len(known), "quiet_days": quiet}
    if len(known) < 3:
        return {**base, "level": "learning", "title": "Getting to know you",
                "text": f"Three days of data are needed to judge your week. You have {len(known)}."}
    average = mean(d["steps"] for d in known if d.get("steps") is not None) if any(d.get("steps") is not None for d in known) else None
    if points >= heart_goal:
        level, title, text = "active", "You are physically active", f"{points} of {heart_goal} Heart Points in 7 days. Well done."
    elif points >= heart_goal / 2:
        level, title = "some", "Somewhat active"
        text = f"{points} of {heart_goal} Heart Points. {heart_goal - points} more: about {human_minutes(heart_goal - points)} of brisk walking."
    else:
        level, title = "inactive", "Not active enough"
        text = f"{points} of {heart_goal} Heart Points in 7 days. Start with a 10-minute brisk walk after one meal each day."
    if average is not None and average < 5000 and level == "some":
        text += " Your average is under 5,000 steps, so you still sit a lot."
    if quiet >= MAX_QUIET_DAYS:
        text += f" {quiet} full days without activity: try not to go past 2 in a row."
    return {**base, "level": level, "title": title, "text": text, "average_steps": round(average) if average is not None else None}


def streak(days: list[dict], step_goal: int, today: date) -> int:
    """Days in a row that reached the step goal (today only if already reached)."""
    reached = {d["day"] for d in days if (d.get("steps") or 0) >= step_goal}
    d, n = today, 0
    if d not in reached:
        d -= timedelta(days=1)
    while d in reached:
        n, d = n + 1, d - timedelta(days=1)
    return n


def sugar_effect(days: list[dict], readings_by_day: dict[date, list[float]], step_goal: int) -> dict:
    """Average sugar on days with more vs fewer steps, from this person's own data."""
    usable = [(d["steps"], mean(readings_by_day[d["day"]])) for d in days
              if d.get("steps") is not None and len(readings_by_day.get(d["day"], [])) >= 2]
    if len(usable) < 8:
        return {"status": "learning", "days": len(usable), "needed": 8,
                "text": f"GlycoVision is learning how activity changes your sugar: {len(usable)} of 8 days with steps and 2 readings."}
    usable.sort()
    k = len(usable) // 2
    low, high = usable[:k], usable[-k:]
    quiet, busy = mean(v for _, v in low), mean(v for _, v in high)
    diff = round(busy - quiet)
    out = {"days": len(usable), "quiet_avg": round(quiet), "busy_avg": round(busy), "difference": diff,
           "quiet_steps": round(mean(s for s, _ in low)), "busy_steps": round(mean(s for s, _ in high))}
    if diff <= -8:
        return {**out, "status": "lower", "text": f"On your more active days your sugar averaged {round(busy)}, against {round(quiet)} on quieter days."}
    if diff >= 8:
        return {**out, "status": "higher", "text": f"Your sugar averaged {round(busy)} on more active days and {round(quiet)} on quieter ones. Food and insulin differ too, so ask your doctor."}
    return {**out, "status": "same", "text": f"Your average sugar is about the same on active ({round(busy)}) and quiet ({round(quiet)}) days so far."}


# ------------------------------------------------------------- sleep and vitals

def sleep_summary(sessions: list[dict], typed: list[dict], now: datetime) -> dict | None:
    """Last night: watch sleep in the last 24 hours, else hours typed in."""
    recent = [s for s in sessions if now - s["end"] <= timedelta(hours=24) and s["end"] <= now]
    if recent:
        # Two apps may record the same night: the longest of overlapping ones.
        recent.sort(key=lambda s: s["end"] - s["start"], reverse=True)
        kept: list[dict] = []
        for s in recent:
            if all(s["end"] <= k["start"] or s["start"] >= k["end"] for k in kept):
                kept.append(s)
        minutes = sum((s["end"] - s["start"]).total_seconds() / 60 - (s.get("awake_min") or 0) for s in kept)
        parts = {k: sum(s.get(k) or 0 for s in kept) or None for k in ("deep_min", "rem_min")}
        return {**_sleep_note(round(minutes)), **parts, "source": "watch"}
    latest = max((v for v in typed if now - v["time"] <= timedelta(hours=24)), key=lambda v: v["time"], default=None)
    return {**_sleep_note(round(latest["value"] * 60)), "deep_min": None, "rem_min": None, "source": "manual"} if latest else None


def _sleep_note(minutes: int) -> dict:
    if minutes < 360:
        level, text = "short", "Short sleep can raise sugar the next day. Check it a little more often."
    elif minutes < 420:
        level, text = "fair", "A little under the 7 hours adults need."
    elif minutes <= 540:
        level, text = "good", "Good sleep helps keep sugar steady."
    else:
        level, text = "long", "Longer than usual. Tell your doctor if you often feel tired."
    return {"minutes": minutes, "level": level, "text": text}


def blood_pressure_level(systolic: float, diastolic: float) -> tuple[str, str]:
    """ACC/AHA 2017 groups. One reading is never a diagnosis."""
    if systolic >= 180 or diastolic >= 120:
        return "urgent", "Very high. Rest 5 minutes and measure again. Get medical help if it stays this high or you feel unwell."
    if systolic < 90 or diastolic < 60:
        return "low", "Low. Sit down, and call a doctor if you feel dizzy or faint."
    if systolic >= 140 or diastolic >= 90:
        return "high", "High (stage 2). Measure again on other days and show your doctor."
    if systolic >= 130 or diastolic >= 80:
        return "raised", "Raised (stage 1). Keep a record for your doctor."
    if systolic >= 120:
        return "elevated", "Slightly raised."
    return "normal", "Normal."


def local_day(t: datetime, tz) -> date:
    return t.astimezone(tz).date()


def utc(t: datetime) -> datetime:
    return t.astimezone(timezone.utc)
