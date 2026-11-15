# GlycoVision backend container (Hugging Face Spaces, Docker SDK).
# Free CPU Space: 2 vCPU, 16 GB RAM. Serves on port 7860 as Spaces expect.
# Secrets (Supabase keys) are set in the Space settings, never in the image.

FROM python:3.14-slim

# ffmpeg: voice checks (pydub). libgomp1: xgboost / torch threading.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    USE_OLLAMA_FALLBACK=false \
    DEFAULT_TIMEZONE=Asia/Karachi
WORKDIR /home/user/app

# CPU-only PyTorch (~200 MB instead of a ~2.5 GB GPU build), then the rest.
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch==2.13.0 torchvision==0.28.0 \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user . .
RUN mkdir -p tmp

EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
