#!/usr/bin/env bash
# COMPAT-01 container-run harness.
#
# Adapted from run-container-check.sh, but the mongo `docker compose up` + /health
# poll are DROPPED — this spike needs neither. It builds the oven/bun:1.3.14-slim
# spike image, asserts the image is arm64, then runs the node-vibrant/sharp
# extraction spike once and exits 0 on success (palette printed to stdout).
#
# RUN TARGET: `docker image inspect --format '{{.Architecture}}'` reports the
# BUILD HOST's arch, so run this on a real arm64 host — Apple Silicon, or
# `ssh oracle` per the v2 precedent — so the arm64 assertion genuinely exercises
# the arm64 sharp/node-vibrant binaries. On an amd64 host, build with
# `--platform=linux/arm64` (qemu-emulated; NOT identical to a real arm64 box for
# sharp's native binary — note that caveat in the findings).
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-medsaas:vibrant-spike}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Building ${IMAGE_NAME} from spike/Dockerfile.vibrant"
docker build -f spike/Dockerfile.vibrant -t "${IMAGE_NAME}" .

ARCH="$(docker image inspect "${IMAGE_NAME}" --format '{{.Architecture}}')"
echo "==> Image architecture: ${ARCH}"
if [ "${ARCH}" != "arm64" ]; then
  echo "FAIL: expected image architecture arm64, got '${ARCH}'." >&2
  echo "      Run on a real arm64 host (Apple Silicon or 'ssh oracle'), or build" >&2
  echo "      with --platform=linux/arm64 (qemu caveat applies to sharp's binary)." >&2
  exit 1
fi

echo "==> Running spike (one-shot)"
docker run --rm "${IMAGE_NAME}"
echo "==> Spike exited 0"
