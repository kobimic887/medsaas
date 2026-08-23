#!/usr/bin/env bash
#
# Read-only inventory of leftover host 83 (83.229.87.94). Not DNS, not production.
# Public Pyxis is 84 + pyxis-web :5174. Do not treat this script's target as live.
#
# THIS SCRIPT ONLY READS. It runs no writes, starts and stops nothing, and edits
# no configuration. That is deliberate and load-bearing: 83 is a shared VPS
# carrying an unrelated project, and the standing rule is
#
#     do not modify nginx, TLS, DNS, or the firewall
#
# If you are tempted to add a command here that changes state, don't — put it in
# the runbook as a gated step instead.
#
# Usage:
#   scripts/inventory-83.sh <ssh-target> [output-file]
#
#   scripts/inventory-83.sh root@83.229.87.94
#   scripts/inventory-83.sh prod-83 inventory.txt
#
# Output goes to stdout and, if given, to a file. Read it before pasting it
# anywhere: leftover host inventory, not the live app. It deliberately prints env
# var NAMES ONLY, never values — but check before sharing regardless.

set -uo pipefail

TARGET="${1:-}"
OUT="${2:-}"

if [ -z "$TARGET" ]; then
  echo "usage: $0 <ssh-target> [output-file]" >&2
  echo "  e.g. $0 root@83.229.87.94" >&2
  exit 2
fi

# Single connection, single heredoc: one authentication, one round trip, and the
# remote side is a plain script with no arguments interpolated into it.
REMOTE=$(cat <<'REMOTE_SCRIPT'
set -u
line() { printf '\n===== %s =====\n' "$1"; }

line "host"
hostname; uname -a; uptime
cat /etc/os-release 2>/dev/null | head -3

line "containers (running)"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
  || echo "docker not available to this user"

line "containers (all, incl. stopped)"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null

line "compose projects"
docker compose ls 2>/dev/null

line "images"
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null | head -30

line "listening sockets"
ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null

line "nginx: server_name / root / proxy_pass (READ ONLY)"
# What is served, and what it proxies to. This is how we learn where the
# production API actually lives, and which webroot the frontend is served from —
# the path that gets symlink-swapped at cutover (ARRIVAL-RUNBOOK 5.0).
grep -rn --include='*.conf' -E 'server_name|root |proxy_pass|index ' /etc/nginx/ 2>/dev/null \
  | grep -v '^\s*#' | head -60

line "webroot candidates"
for d in /var/www /srv/www /usr/share/nginx/html /opt; do
  [ -d "$d" ] && ls -la "$d" 2>/dev/null | head -20 && echo "--- ($d)"
done

line "frontend bundle: build fingerprint"
# index.html plus the hashed asset names identify the build. If a source map or
# a version marker survives, it dates the bundle against this repo.
for d in /var/www/* /usr/share/nginx/html; do
  [ -f "$d/index.html" ] || continue
  echo "--- $d"
  ls -la "$d" | head -15
  echo "  mtime: $(stat -c '%y' "$d/index.html" 2>/dev/null)"
done

line "frontend bundle: which API endpoints it calls"
# Crude and sufficient: grep the minified JS for /api/ string literals. Diff this
# against this repo's routes to size the frontend delta (runbook 0.9b). An
# endpoint the old bundle calls that the new server no longer serves is a
# rollback that fails silently.
find /var/www /usr/share/nginx/html -name '*.js' -type f 2>/dev/null | head -20 | while read -r f; do
  grep -o '"/api/[a-zA-Z0-9/_-]*"' "$f" 2>/dev/null
done | sort -u | head -60

line "mongo"
# Where production data lives. Counts only — no documents are read.
if command -v mongosh >/dev/null 2>&1; then MSH=mongosh; elif command -v mongo >/dev/null 2>&1; then MSH=mongo; else MSH=""; fi
if [ -n "$MSH" ]; then
  $MSH --quiet --eval '
    db.getMongo().getDBNames().forEach(function(n){
      if (["admin","local","config"].indexOf(n) >= 0) return;
      print("db: " + n);
      db.getSiblingDB(n).getCollectionNames().forEach(function(c){
        print("   " + c + ": " + db.getSiblingDB(n)[c].countDocuments());
      });
    });
  ' 2>&1 | head -60
else
  echo "no mongo shell on host — check for a containerised mongo above, then:"
  echo "  docker exec -it <mongo-container> mongosh --quiet --eval '...'"
fi

line "multi-tenancy readiness (runbook 0.10) — BLOCKING CHECK"
# If production users predate multi-tenancy they have no companyId, every
# tenant-filtered query returns nothing, and they log in to empty accounts.
# usersWithoutCompanyId MUST be 0 before any cutover.
if [ -n "${MSH:-}" ]; then
  $MSH --quiet --eval '
    db.getMongo().getDBNames().forEach(function(n){
      if (["admin","local","config"].indexOf(n) >= 0) return;
      var d = db.getSiblingDB(n);
      if (d.getCollectionNames().indexOf("users") < 0) return;
      print(n + ": users=" + d.users.countDocuments()
        + " withoutCompanyId=" + d.users.countDocuments({companyId: {$exists: false}})
        + " companies=" + (d.getCollectionNames().indexOf("companies") >= 0 ? d.companies.countDocuments() : "NO companies COLLECTION"));
    });
  ' 2>&1 | head -20
fi

line "app env — NAMES ONLY, never values"
# Values are secrets. Names tell us what the backend expects, which is what we
# need in order to build the box's .env.
for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
  echo "--- $c"
  docker exec "$c" env 2>/dev/null | cut -d= -f1 | sort | head -40
done

line "disk"
df -h | grep -vE '^(tmpfs|devtmpfs|overlay)'

line "done"
REMOTE_SCRIPT
)

run() {
  echo "# inventory of $TARGET"
  echo "# generated by scripts/inventory-83.sh — READ ONLY, no writes performed"
  echo "# $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  # BatchMode keeps this from hanging on an unexpected password prompt.
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$TARGET" 'bash -s' <<< "$REMOTE" 2>&1
}

if [ -n "$OUT" ]; then
  run | tee "$OUT"
  echo
  echo "written to $OUT — review before sharing; leftover 83, not the live app" >&2
else
  run
fi
