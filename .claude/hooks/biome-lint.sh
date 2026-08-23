#!/usr/bin/env bash
# PostToolUse: Biome lint only (never format --write) on js/jsx/mjs via bun.
set -u
input="$(cat || true)"
file="$(python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
t=d.get("tool_input") or {}
print(t.get("file_path") or t.get("path") or "")' <<<"$input")"

[ -n "$file" ] || exit 0
case "$file" in
  *.js|*.jsx|*.mjs) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/*|*/dist/*) exit 0 ;;
esac

BUN="$(command -v bun 2>/dev/null || true)"
if [ -z "${BUN}" ] || [ ! -x "${BUN}" ]; then
  BUN="${HOME}/.bun/bin/bun"
fi
if [ ! -x "${BUN}" ]; then
  echo "biome-lint hook: bun missing (PATH and ~/.bun/bin)" >&2
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "${ROOT}" ]; then
  ROOT="$(pwd)"
fi

if [ -x "${ROOT}/node_modules/.bin/biome" ]; then
  "${ROOT}/node_modules/.bin/biome" lint -- "${file}" >&2
  exit 0
fi
if [ -x "${ROOT}/node_modules/@biomejs/biome/bin/biome" ]; then
  "${ROOT}/node_modules/@biomejs/biome/bin/biome" lint -- "${file}" >&2
  exit 0
fi

# package.json script is "biome lint" — never lint:fix / format --write
if [ -f "${ROOT}/package.json" ]; then
  "${BUN}" --cwd="${ROOT}" run lint -- "${file}" >&2 || true
  exit 0
fi

echo "biome-lint hook: skip (no local biome / package.json)" >&2
exit 0
