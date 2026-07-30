# syntax=docker/dockerfile:1.7
#
# ADMET worker. Polls the `admet_jobs` collection in MongoDB — no broker.
#
# Two targets:
#   test       python:3.10-slim. The queue protocol, the retry ladder, the reaper and the
#              callback shape, all with no GPU, no network and no model. Builds on a laptop.
#   runtime    CUDA 12.8 + cu128 torch + admet-ai. x86_64 only. Build it on the box.
#
# `docker build services/admet` gives you `runtime`, which is what compose wants.
# `docker build --target test services/admet` gives you something you can run today.

ARG CUDA_VERSION=12.8.1

# ── test: the worker logic, no model ─────────────────────────────────────────
FROM python:3.10-slim-bookworm AS test

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ADMET_ENGINE=stub

WORKDIR /app
COPY requirements.txt requirements-test.txt ./
RUN python -m pip install --upgrade "pip==25.0.1" \
    && python -m pip install --requirement requirements.txt --requirement requirements-test.txt

COPY pyproject.toml ./
COPY admet_worker ./admet_worker
COPY tests ./tests
CMD ["python", "-m", "pytest", "-q"]


# ── runtime: the real one ────────────────────────────────────────────────────
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    ADMET_ENGINE=admet-ai

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
         ca-certificates python3.10 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1

RUN python -m pip install --upgrade "pip==25.0.1" "setuptools==80.9.0" "wheel==0.45.1"

WORKDIR /app

# Pass 1: torch alone, from the cu128 index. See requirements-model.txt for why this is
# split — installing admet-ai first lets chemprop's pins pull the CPU wheel in silently.
RUN python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 \
      "torch==2.7.1+cu128"

# Pass 2: everything else, on top of a torch that already exists.
COPY requirements-model.txt ./
RUN python -m pip install --requirement requirements-model.txt

# ⚠ The failure this catches never raises on its own — it is just slow, forever.
# torch.cuda.is_available() is NOT the check here: there is no GPU during a docker build and
# it would be False even on a perfect image. The build tag and the compiled arch list are
# what can be verified at build time; availability is checked at worker startup instead.
RUN python - <<'PY'
import torch
version = torch.__version__
assert "cu128" in version, f"torch is not the cu128 build: {version}"
arches = torch.cuda.get_arch_list()
assert any(a.startswith("sm_120") for a in arches), f"no sm_120 in {arches}"
print(f"OK: torch {version} targets {arches}")
PY

COPY requirements.txt ./
RUN python -m pip install --requirement requirements.txt

COPY pyproject.toml ./
COPY admet_worker ./admet_worker
RUN python -m pip install --no-deps .

# No port and no healthcheck: this is a worker, not a server. Whether it is doing anything
# is answered by `GET /api/rabbitmq/queue-status`, which counts jobs per state — the exact
# question the broker could not answer, and the reason ADMET sat broken for months.
CMD ["python", "-m", "admet_worker"]
