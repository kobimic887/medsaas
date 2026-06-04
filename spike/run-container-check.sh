#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-medsaas:bun-spike}"
CONTAINER_NAME="${CONTAINER_NAME:-medsaas-bun-spike}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-medsaasbunspike}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HOST_PORT="${HOST_PORT:-3000}"
APP_PORT="${APP_PORT:-3000}"
MONGO_DB="${MONGO_DB:-bun_spike_server}"
NETWORK_NAME="${COMPOSE_PROJECT_NAME}_default"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export COMPOSE_PROJECT_NAME
docker compose -f "$COMPOSE_FILE" up -d mongo

for _ in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-mongo-1" 2>/dev/null || true)" = "healthy" ]; then
    break
  fi
  sleep 2
done

if [ "$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-mongo-1" 2>/dev/null || true)" != "healthy" ]; then
  docker compose -f "$COMPOSE_FILE" ps mongo
  echo "MongoDB did not become healthy" >&2
  exit 1
fi

docker build -f spike/Dockerfile.bun -t "$IMAGE_NAME" .

ARCH="$(docker image inspect "$IMAGE_NAME" --format '{{.Architecture}}')"
if [ "$ARCH" != "arm64" ]; then
  echo "Expected arm64 image, got $ARCH" >&2
  exit 1
fi

cleanup
docker run -d \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  -p "${HOST_PORT}:${APP_PORT}" \
  -e PORT="$APP_PORT" \
  -e NODE_ENV=test \
  -e MONGODB_URI="mongodb://mongo:27017/${MONGO_DB}" \
  -e JWT_SECRET="${JWT_SECRET:-bun_spike_jwt_secret_at_least_32_chars}" \
  -e STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-sk_test_bun_spike_unused_dummy_key}" \
  "$IMAGE_NAME" >/dev/null

for _ in $(seq 1 120); do
  STATUS="$(curl -fsS -o /tmp/medsaas-bun-spike-health.json -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/health" 2>/dev/null || true)"
  if [ "$STATUS" = "200" ]; then
    echo "PASS: container /health returned HTTP 200"
    cat /tmp/medsaas-bun-spike-health.json
    echo
    exit 0
  fi
  sleep 1
done

echo "Container did not serve /health within timeout" >&2
docker logs "$CONTAINER_NAME" >&2 || true
exit 1
