# syntax=docker/dockerfile:1.7
# The service is qualified only for the box's linux/amd64 target.
FROM --platform=linux/amd64 python:3.11.10-slim-bookworm AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /build

RUN python -m venv "$VIRTUAL_ENV" \
    && python -m pip install --upgrade "pip==25.0.1" "setuptools==80.9.0" "wheel==0.45.1"

COPY requirements.txt ./
RUN python -m pip install --requirement requirements.txt

COPY pyproject.toml ./
COPY docking_service ./docking_service
RUN python -m pip install --no-deps .


FROM --platform=linux/amd64 python:3.11.10-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH= \
    HOME=/tmp \
    CACHE_DIR=/srv/cache \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 docking \
    && useradd --uid 10001 --gid docking --create-home --shell /usr/sbin/nologin docking \
    && install --directory --owner=docking --group=docking --mode=0750 /srv/cache

COPY --from=build /opt/venv /opt/venv

WORKDIR /srv/docking
USER docking:docking
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/health', timeout=5)"
CMD ["python", "-m", "docking_service", "serve"]


# Docker-only test target: it never becomes the deployed runtime image.
FROM runtime AS test
USER root:root
WORKDIR /srv/docking
COPY requirements-test.txt ./
RUN python -m pip install --requirement requirements-test.txt
COPY --chown=docking:docking tests ./tests
USER docking:docking
CMD ["python", "-m", "pytest", "-m", "not vina", "-q"]


# Keep the normal unqualified build target as the minimal runtime image.
FROM runtime AS production
