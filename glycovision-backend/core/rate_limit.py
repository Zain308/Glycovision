"""
Simple in-memory rate limiting (no extra packages, free).

Each caller gets a sliding one-minute window per route group:
  * "heavy"  - running photo or voice analysis (CPU-expensive POSTs): 20 / min
  * "default" - everything else: 120 / min
A caller is identified by its login token (so one user on a shared Wi-Fi
does not block another), or by IP address when there is no token.
Over the limit, the API answers 429 with a Retry-After header.

Limits are per server process; behind several workers each process
counts separately, which is fine for a single-instance deployment.
"""

import hashlib
import threading
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

WINDOW_SECONDS = 60
LIMITS = {"heavy": 20, "default": 120}
# Only the expensive analysis requests; cheap reads like /stress-context
# or /voice-history use the default limit.
HEAVY_PATH_PARTS = ("analyze-meal", "stress-analyze")
EXEMPT_PATHS = {"/", "/health", "/docs", "/openapi.json"}

_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_lock = threading.Lock()


def _caller(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth:
        return "t:" + hashlib.sha256(auth.encode()).hexdigest()[:24]
    return "ip:" + (request.client.host if request.client else "unknown")


def _group(method: str, path: str) -> str:
    if method == "POST" and any(p in path for p in HEAVY_PATH_PARTS):
        return "heavy"
    return "default"


def reset() -> None:
    """Clear all counters (used by tests)."""
    with _lock:
        _hits.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in EXEMPT_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        group = _group(request.method, path)
        limit = LIMITS[group]
        key = (_caller(request), group)
        now = time.monotonic()

        with _lock:
            q = _hits[key]
            while q and now - q[0] > WINDOW_SECONDS:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, int(WINDOW_SECONDS - (now - q[0])) + 1)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please wait a moment and try again."},
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)
            # Drop idle callers so the table cannot grow forever.
            if len(_hits) > 5000:
                for k in [k for k, v in _hits.items() if not v or now - v[-1] > WINDOW_SECONDS]:
                    del _hits[k]

        return await call_next(request)
