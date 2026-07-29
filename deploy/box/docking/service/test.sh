#!/usr/bin/env bash
# Run only on a remote Docker-capable linux/amd64 host. This script never invokes
# Python, Node, chemistry tooling, or Docker on the host outside containers.
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
TEST_IMAGE="pyxis-docking:test"
RUNTIME_IMAGE="pyxis-docking:runtime"
NETWORK="pyxis-docking-replay-$RANDOM-$$"
SERVICE="pyxis-docking-replay-$RANDOM-$$"

cleanup() {
  status=$?
  if docker ps --all --format '{{.Names}}' | grep -Fxq "$SERVICE"; then
    if [ "$status" -ne 0 ]; then
      docker logs "$SERVICE" >&2 || true
    fi
    docker rm --force "$SERVICE" >/dev/null || true
  fi
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# The two named targets make the test/runtime separation explicit and pin the architecture.
docker build --platform linux/amd64 --target test --tag "$TEST_IMAGE" "$SCRIPT_DIR"
docker build --platform linux/amd64 --target runtime --tag "$RUNTIME_IMAGE" "$SCRIPT_DIR"

# The replay suite is offline by contract: any unintended request-time network call fails.
docker run --rm \
  --platform linux/amd64 \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g \
  -e DOCKING_ENGINE=replay \
  -e CACHE_DIR=/tmp/cache \
  "$TEST_IMAGE" \
  python -m pytest -p no:cacheprovider -m 'not vina' -q

# Exercise the actual HTTP service on an internal-only Docker network.
docker network create --internal "$NETWORK" >/dev/null
docker run --detach \
  --name "$SERVICE" \
  --platform linux/amd64 \
  --network "$NETWORK" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g \
  -e DOCKING_ENGINE=replay \
  -e CACHE_DIR=/tmp/cache \
  "$RUNTIME_IMAGE" >/dev/null

healthy=0
for _attempt in $(seq 1 30); do
  if docker exec "$SERVICE" curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  echo "docking service did not become healthy" >&2
  exit 1
fi

# The verifier is immutable. Mount only the verifier and baseline, never the whole checkout.
docker run --rm \
  --network "$NETWORK" \
  --user 1000:1000 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=${REPO_ROOT}/scripts/verify-docking-response.mjs,dst=/verify.mjs,readonly" \
  --mount "type=bind,src=${REPO_ROOT}/deploy/box/docking/reference/1cx7-asinex.json,dst=/baseline.json,readonly" \
  node:24-bookworm \
  sh -ec "node -e '\
const fs = require(\"node:fs/promises\");\
const body = {pdbID: \"1cx7\", smiles: \"Cc1c(non1)OCCn2c(ncc2%5BN%2B%5D(%3DO)%5BO-%5D)C\"};\
fetch(\"http://${SERVICE}:8000/docking\", {method: \"POST\", headers: {\"content-type\": \"application/json\"}, body: JSON.stringify(body)})\
  .then(async response => { if (!response.ok) throw new Error(\"dock HTTP \" + response.status); await fs.writeFile(\"/tmp/candidate.json\", await response.text()); })\
  .catch(error => { console.error(error); process.exit(1); });' \
&& node /verify.mjs --file /tmp/candidate.json --baseline /baseline.json"

# Explicit opt-in only: this suite downloads the real RCSB receptor and runs CPU Vina.
if [ "${RUN_VINA:-0}" = "1" ]; then
  docker run --rm \
    --platform linux/amd64 \
    --network bridge \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=2g \
    -e DOCKING_ENGINE=vina \
    -e CACHE_DIR=/tmp/cache \
    "$TEST_IMAGE" \
    python -m pytest -p no:cacheprovider -m vina -q
fi
