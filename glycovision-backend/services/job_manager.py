import threading
import time
import uuid

from datetime import datetime, timezone


# Meal-scan jobs live in memory only until the app has fetched the result.
# Without cleanup every result (with its nutrition data) stayed in memory
# until the server restarted. Jobs now expire after JOB_TTL_SECONDS, and at
# most MAX_JOBS are kept (oldest dropped first).
JOB_TTL_SECONDS = 15 * 60
MAX_JOBS = 200

_jobs = {}
_lock = threading.Lock()


def _prune_locked() -> None:
    """Drop expired jobs, then the oldest beyond MAX_JOBS. Caller holds _lock."""
    now = time.monotonic()
    for job_id in [j for j, job in _jobs.items() if now - job["_created"] > JOB_TTL_SECONDS]:
        del _jobs[job_id]
    if len(_jobs) > MAX_JOBS:
        # dicts keep insertion order: the first keys are the oldest jobs
        for job_id in list(_jobs)[: len(_jobs) - MAX_JOBS]:
            del _jobs[job_id]


def create_job(
    user_id: str,
) -> str:

    job_id = str(
        uuid.uuid4()
    )

    with _lock:

        _prune_locked()

        _jobs[job_id] = {

            "_created": time.monotonic(),

            "user_id": user_id,

            "status": "pending",

            "result": None,

            "error": None,

            "created_at":
                datetime.now(
                    timezone.utc
                ).isoformat(),
        }

    return job_id


def set_job_result(
    job_id: str,
    result: dict,
):

    with _lock:

        if job_id in _jobs:

            _jobs[job_id][
                "status"
            ] = "complete"

            _jobs[job_id][
                "result"
            ] = result


def set_job_error(
    job_id: str,
    error: str,
):

    with _lock:

        if job_id in _jobs:

            _jobs[job_id][
                "status"
            ] = "error"

            _jobs[job_id][
                "error"
            ] = error


def get_job(
    job_id: str,
) -> dict | None:

    with _lock:

        job = _jobs.get(
            job_id
        )

        if job is None:

            return None

        return {k: v for k, v in job.items() if k != "_created"}


def get_job_for_user(
    job_id: str,
    user_id: str,
) -> dict | None:

    with _lock:

        job = _jobs.get(
            job_id
        )

        if job is None:

            return None

        if (
            job.get("user_id")
            != user_id
        ):

            return None

        return {k: v for k, v in job.items() if k != "_created"}