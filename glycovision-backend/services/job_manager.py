import threading
import uuid

from datetime import datetime, timezone


_jobs = {}
_lock = threading.Lock()


def create_job(
    user_id: str,
) -> str:

    job_id = str(
        uuid.uuid4()
    )

    with _lock:

        _jobs[job_id] = {

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

        return job.copy()


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

        return job.copy()