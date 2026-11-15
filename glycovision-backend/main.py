from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import (
    meal,
    bolus,
    stress,
    dashboard,
    profile,
    bg,
    spike,
)
from core.config import get_settings
from core.rate_limit import RateLimitMiddleware


settings = get_settings()

app = FastAPI(
    title="GlycoVision AI Backend",
    description="Medical Digital Twin for Type 1 Diabetes – Computer Vision + Bolus Engine + Stress Biomarkers",
    version="1.0.0",
    docs_url="/docs",
)

# Per-caller request limits (429 when exceeded); see core/rate_limit.py.
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    # Set CORS_ORIGINS in .env to restrict browser access in production.
    allow_origins=settings.cors_origin_list,
    # Auth uses a bearer token, not cookies, so credentials aren't needed.
    # (Browsers also reject credentials combined with a "*" origin.)
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meal.router)
app.include_router(bolus.router)
app.include_router(stress.router)
app.include_router(dashboard.router)
app.include_router(profile.router)
app.include_router(bg.router)
app.include_router(
    spike.router
)


@app.get("/")
def root():
    return {
        "service": "GlycoVision AI",
        "status": "online",
        "version": "1.0.0",
        "modules": ["vision", "bolus", "stress"]
    }

@app.get("/health")
def health():
    return {"status": "healthy"}