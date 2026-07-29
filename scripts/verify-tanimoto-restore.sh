#!/usr/bin/env bash
# Prove the Tanimoto pg_dump actually restores — versions lining up is not the same
# as the archive being good.
#
# WHY THIS EXISTS
#   ~/backups/tanimoto/tonomitosql-*.dump is the ONLY copy of the production Tanimoto
#   index: 2,951,975 molecules, built from molsd4.csv, indexed 2026-03-12. Nobody knows
#   whether molsd4.csv still exists, so rebuilding is not a fallback. An unauthenticated
#   internet-reachable DELETE currently proxies to the live dataset, so the dump may
#   become the only copy at any moment.
#
#   A verified sha256 proves the bytes survived the copy. It does not prove pg_restore
#   can read them, that CREATE EXTENSION rdkit succeeds, or that the rows are all there.
#   This script asserts the row count, because a restore can exit 0 having restored a
#   schema and no data.
#
# WHERE TO RUN IT
#   Any x86_64 host with Docker. The box, once it exists. NOT the operator's Mac —
#   there is no container runtime on it (checked 2026-07-29).
#
# USAGE
#   scripts/verify-tanimoto-restore.sh [path-to-dump]
#
# It cleans up its own container and volume. It touches nothing in production and does
# not need network access to Oracle.

set -euo pipefail

DUMP="${1:-$HOME/backups/tanimoto/tonomitosql-20260729.dump}"

# Pinned deliberately — see deploy/box/.env.example. The dump is archive format 1.16,
# which only PostgreSQL 17's pg_restore reads; :latest is a moving tag that could be
# rebuilt onto 18. The image tags are RDKit releases and say nothing about the Postgres
# major, which is exactly why this is pinned rather than tracked.
IMAGE="informaticsmatters/rdkit-cartridge-debian:Release_2025_03_3"

CONTAINER="tanimoto-restore-proof"
PGPASSWORD_VALUE="restore-proof-not-a-secret"
EXPECTED_ROWS=2951975

fail() { echo "FAIL: $*" >&2; exit 1; }
note() { echo "==> $*"; }

[ -f "$DUMP" ] || fail "no dump at $DUMP"
command -v docker >/dev/null || fail "docker not available — run this on the box, not the Mac"

if [ -f "$DUMP.sha256" ]; then
  note "checking sha256"
  (cd "$(dirname "$DUMP")" && shasum -a 256 -c "$(basename "$DUMP").sha256") \
    || fail "checksum mismatch — the archive is damaged, do NOT restore from it"
else
  echo "WARN: no .sha256 sidecar next to the dump; continuing without it" >&2
fi

note "dump header"
head -c 512 "$DUMP" | strings | sed -n '1,3p'

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

note "starting $IMAGE"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD_VALUE" \
  -e POSTGRES_USER=postgres \
  "$IMAGE" >/dev/null

note "waiting for postgres"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 \
  || fail "postgres never became ready"

note "server version"
docker exec "$CONTAINER" psql -U postgres -tAc 'SHOW server_version'

note "creating target database and the rdkit extension"
docker exec "$CONTAINER" psql -U postgres -c 'CREATE DATABASE tonomitosql' >/dev/null
docker exec "$CONTAINER" psql -U postgres -d tonomitosql -c 'CREATE EXTENSION IF NOT EXISTS rdkit' >/dev/null \
  || fail "CREATE EXTENSION rdkit failed — wrong image, or the cartridge is missing"

note "restoring (this is 1.2 GB; expect minutes, not seconds)"
docker exec -i "$CONTAINER" pg_restore -U postgres -d tonomitosql --no-owner --no-privileges \
  < "$DUMP" || fail "pg_restore exited non-zero"

note "tables restored"
docker exec "$CONTAINER" psql -U postgres -d tonomitosql -tAc \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"

# The assertion that matters. pg_restore can exit 0 having created an empty schema.
note "counting molecules"
TABLE=$(docker exec "$CONTAINER" psql -U postgres -d tonomitosql -tAc \
  "SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name ILIKE '%mol%' ORDER BY 1 LIMIT 1" | tr -d '[:space:]')
[ -n "$TABLE" ] || fail "no molecule-ish table found after restore — the data did not come across"

ROWS=$(docker exec "$CONTAINER" psql -U postgres -d tonomitosql -tAc \
  "SELECT count(*) FROM public.\"$TABLE\"" | tr -d '[:space:]')
echo "    $TABLE: $ROWS rows (expected $EXPECTED_ROWS)"

if [ "$ROWS" -eq "$EXPECTED_ROWS" ]; then
  echo
  echo "PASS: restore verified — $ROWS molecules, matching the live index."
elif [ "$ROWS" -gt 0 ]; then
  echo
  echo "PARTIAL: restored $ROWS rows but expected $EXPECTED_ROWS."
  echo "Do not treat this as a good backup until the difference is explained."
  exit 1
else
  fail "restored zero rows — the archive is not a usable backup"
fi
