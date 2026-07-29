# syntax=docker/dockerfile:1

ARG PYTHON_IMAGE=python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

FROM ${PYTHON_IMAGE} AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --requirement requirements.txt

COPY app.py ./

RUN useradd --create-home --home-dir /home/convertstr --shell /usr/sbin/nologin --uid 10001 convertstr

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8001/health || exit 1

USER 10001:10001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--no-access-log"]

FROM base AS test

USER root
COPY requirements-test.txt ./
RUN python -m pip install --no-cache-dir --requirement requirements-test.txt
COPY tests/ ./tests/
USER 10001:10001

CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "--basetemp=/tmp/pytest", "tests"]

FROM base AS runtime
