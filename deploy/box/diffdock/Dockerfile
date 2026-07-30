# syntax=docker/dockerfile:1.7
#
# Two worlds in one file, on purpose:
#
#   wrapper / test  python:3.10-slim, FastAPI only. Builds and passes its tests on any
#                   machine, including an arm64 laptop, with no GPU and no network.
#   runtime         CUDA 12.8 + torch cu128 + upstream DiffDock. x86_64 only, ~8 GB, and
#                   it CANNOT be built on an arm64 Mac — build it on the box.
#
# `docker build deploy/box/diffdock` gives you `runtime`, which is what compose wants.
# `docker build --target test deploy/box/diffdock` gives you something you can run today.

ARG CUDA_VERSION=12.8.1
ARG DIFFDOCK_REF=9a22cbcbc7612c7565c80e8399d9be298971f156

# ── wrapper: the HTTP service, no model ──────────────────────────────────────
FROM python:3.10-slim-bookworm AS wrapper

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DIFFDOCK_ENGINE=replay

WORKDIR /build
COPY requirements.txt ./
RUN python -m pip install --upgrade "pip==25.0.1" "setuptools==80.9.0" "wheel==0.45.1" \
    && python -m pip install --requirement requirements.txt

COPY pyproject.toml ./
COPY diffdock_service ./diffdock_service
RUN python -m pip install --no-deps .

WORKDIR /srv/diffdock
EXPOSE 8002
CMD ["python", "-m", "diffdock_service", "serve"]


# ── test: wrapper + pytest. No GPU, no network, no weights. ──────────────────
FROM wrapper AS test
WORKDIR /build
COPY requirements-test.txt ./
RUN python -m pip install --requirement requirements-test.txt
COPY tests ./tests
# The tests assert against the captured Asinex payloads directly, so the reference travels
# with them — that is the point of the suite, not a fixture convenience.
COPY reference ./reference
CMD ["python", "-m", "pytest", "-q"]


# ── runtime: the real one ────────────────────────────────────────────────────
# Ubuntu 22.04 ships Python 3.10 as its system interpreter, which is why 3.10 is the target
# everywhere here: torch 2.7.1+cu128 is the last release with cp310 wheels for this line, and
# every one of DiffDock's own 2022-era pins still has a cp310 wheel. No deadsnakes PPA, no
# conda, no source builds.
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04 AS runtime
ARG DIFFDOCK_REF

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    DIFFDOCK_ENGINE=oss \
    DIFFDOCK_REPO_DIR=/opt/diffdock \
    DIFFDOCK_MODEL_DIR=/models \
    DIFFDOCK_WORK_DIR=/tmp/diffdock

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
         ca-certificates curl git python3.10 python3.10-venv python3-pip libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1

RUN python -m pip install --upgrade "pip==25.0.1" "setuptools==80.9.0" "wheel==0.45.1"

# DiffDock's dependency set goes in FIRST and ALONE. The wrapper's pins land on top of it and
# must not be allowed to drag a different torch in behind them — see the guard below.
COPY requirements-oss.txt ./
RUN python -m pip install --requirement requirements-oss.txt

COPY requirements.txt ./
RUN python -m pip install --requirement requirements.txt

# ⚠ The failure this catches never raises on its own. If anything in the second install
# resolved torch again, pip silently replaces the +cu128 build with the default CPU wheel and
# the service runs — just permanently, silently, on the CPU. Assert the build tag instead.
RUN python - <<'PY'
import torch
version = torch.__version__
assert "cu128" in version, f"torch is not the cu128 build: {version}"
arches = torch.cuda.get_arch_list()
assert any(a.startswith("sm_120") for a in arches), f"no sm_120 in {arches}"
print(f"OK: torch {version} targets {arches}")
PY

# Upstream DiffDock, pinned to a commit rather than a branch.
RUN git clone --filter=blob:none https://github.com/gcorso/DiffDock.git /opt/diffdock \
    && git -C /opt/diffdock checkout --quiet "${DIFFDOCK_REF}" \
    && rm -rf /opt/diffdock/.git

# Weights are NOT baked in. compose mounts /srv/models/diffdock at /models read-only; run
# deploy/box/diffdock/fetch-weights.sh once on the box to populate it.
RUN mkdir -p /models /tmp/diffdock

# The wrapper is pure Python — reinstall it here rather than copying site-packages across two
# different distributions' interpreters.
COPY pyproject.toml ./
COPY diffdock_service ./diffdock_service
RUN python -m pip install --no-deps .

WORKDIR /srv/diffdock
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -fsS http://localhost:8002/health || exit 1
CMD ["python", "-m", "diffdock_service", "serve"]
