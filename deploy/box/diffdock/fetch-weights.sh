#!/usr/bin/env bash
# Populate the DiffDock weights volume. Run ONCE on the box, before starting the service.
#
#   sudo mkdir -p /srv/models/diffdock
#   sudo deploy/box/diffdock/fetch-weights.sh /srv/models/diffdock
#
# Weights are a volume artifact, never a request-time download — compose mounts this
# directory read-only at /models. DiffDock's inference.py WILL fetch them itself if they are
# absent, which is exactly the behaviour to avoid: a 124 MB download inside a user's dock,
# once per cold container, with no cache and no failure handling.
#
# ⚠ The URL is not the obvious one. inference.py tries
#   .../releases/latest/download/diffdock_models.zip   -> 404 today (v1.1.3 ships no assets)
#   .../releases/download/v1.1/diffdock_models.zip     -> 200, 129,825,226 bytes
# Only the pinned v1.1 release carries the archive. Checked 2026-07-30.
set -euo pipefail

TARGET="${1:-/srv/models/diffdock}"
URL="https://github.com/gcorso/DiffDock/releases/download/v1.1/diffdock_models.zip"
EXPECTED_BYTES=129825226
EXPECTED_SHA256=5a95b6a1555be47ab1d6f0a8ffd25152f7fe32f5956005bb821e13e7a37d4a3d

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

mkdir -p "$TARGET"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

echo "downloading DiffDock weights"
curl -fsSL "$URL" -o "$workdir/diffdock_models.zip"

actual_bytes="$(wc -c < "$workdir/diffdock_models.zip" | tr -d ' ')"
if [ "$actual_bytes" != "$EXPECTED_BYTES" ]; then
  echo "size mismatch: expected $EXPECTED_BYTES bytes, got $actual_bytes." >&2
  echo "Upstream may have republished the release. Verify before using these weights." >&2
  exit 1
fi

python3 - "$workdir/diffdock_models.zip" "$EXPECTED_SHA256" <<'PYHASH'
import hashlib, sys
from pathlib import Path
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit("DiffDock weights SHA-256 mismatch")
PYHASH

unzip -q "$workdir/diffdock_models.zip" -d "$workdir/extracted"

# The archive lays out workdir/v1.1/{score_model,confidence_model}; the service expects those
# two directories directly under the volume root, because that is what compose mounts.
src="$workdir/extracted"
[ -d "$src/workdir/v1.1" ] && src="$src/workdir/v1.1"

for model in score_model confidence_model; do
  if [ ! -d "$src/$model" ]; then
    echo "archive layout changed: $model not found under $src" >&2
    find "$workdir/extracted" -maxdepth 3 -type d >&2
    exit 1
  fi
  rm -rf "${TARGET:?}/$model"
  cp -R "$src/$model" "$TARGET/$model"
done

echo "OK: weights installed in $TARGET"
ls -la "$TARGET"
