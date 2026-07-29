#!/usr/bin/env bash
set -euo pipefail

GITHUB_REPO="PromptForcePrime/prefex"
SITE_URL="https://prefex.vercel.app"
BASE_URL="https://github.com/${GITHUB_REPO}/releases/latest/download"
INSTALL_DIR="${HOME}/.prefex"

# ── User-tunable knobs (env vars or defaults) ────────────────────────────────
# Override before piping:
#   PREFEX_BIND=0.0.0.0 PREFEX_PORT=9019 curl -fsSL ... | bash
PREFEX_BIND="${PREFEX_BIND:-127.0.0.1}"
PREFEX_PORT="${PREFEX_PORT:-8019}"
# On upgrade, prefer whatever port is already in the config.
if [ -f "${INSTALL_DIR}/config.yaml" ]; then
  CONFIGURED_PORT=$(grep -E '^\s+port:\s*[0-9]+' "${INSTALL_DIR}/config.yaml" 2>/dev/null | head -1 | awk '{print $2}' || true)
  if [ -n "$CONFIGURED_PORT" ] && [ "$CONFIGURED_PORT" -gt 0 ] 2>/dev/null; then
    PREFEX_PORT="$CONFIGURED_PORT"
  fi
fi
PROXY_URL="http://localhost:${PREFEX_PORT}"

# ── Colours (no-op when not a terminal) ─────────────────────────────────────

if [ -t 1 ]; then
  BOLD="\033[1m"; GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"; RESET="\033[0m"
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

info()    { printf "${GREEN}==>${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}warn:${RESET} %s\n" "$*" >&2; }
die()     { printf "${RED}error:${RESET} %s\n" "$*" >&2; exit 1; }
heading() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

# ── Platform detection ───────────────────────────────────────────────────────

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  darwin) ;;
  linux)  ;;
  *) die "Unsupported OS: $(uname -s). Prefex supports macOS and Linux." ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac

# ── Detect existing installation ─────────────────────────────────────────────

UPGRADE=false
if [ -f "${INSTALL_DIR}/data/prefex.db" ] || [ -f "${INSTALL_DIR}/prefex.pid" ]; then
  UPGRADE=true
fi

# ── Stop anything on port $PREFEX_PORT ───────────────────────────────────────

stop_existing() {
  if [ -f "${INSTALL_DIR}/prefex.pid" ]; then
    local pid
    pid=$(cat "${INSTALL_DIR}/prefex.pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      info "Stopping existing Prefex (PID ${pid})…"
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "${INSTALL_DIR}/prefex.pid"
  fi
  local blocker
  blocker=$(lsof -ti ":${PREFEX_PORT}" 2>/dev/null || true)
  if [ -n "$blocker" ]; then
    info "Killing process on port ${PREFEX_PORT} (PID ${blocker})…"
    kill "$blocker" 2>/dev/null || true
    sleep 1
  fi
}

# Suspend Claude Code routing during upgrade so in-flight calls go direct.
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
SUSPENDED=false
suspend_routing() {
  if [ -f "$CLAUDE_SETTINGS" ] && grep -q "localhost\|127.0.0.1" "$CLAUDE_SETTINGS" 2>/dev/null; then
    info "Suspending Claude Code routing during upgrade…"
    if command -v python3 &>/dev/null; then
      python3 - "$CLAUDE_SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
try:
    cfg = json.loads(open(path).read())
    cfg.setdefault('env', {})['ANTHROPIC_BASE_URL'] = 'https://api.anthropic.com'
    open(path, 'w').write(json.dumps(cfg, indent=2))
except Exception as e:
    print(f"warn: could not suspend routing: {e}", file=sys.stderr)
PY
    fi
    SUSPENDED=true
  fi
}

# ── Download binary ───────────────────────────────────────────────────────────

if [ "$UPGRADE" = "true" ]; then
  heading "Upgrading Prefex (${OS}/${ARCH})"
else
  heading "Installing Prefex (${OS}/${ARCH})"
fi

BINARY_NAME="prefex-${OS}-${ARCH}"
BINARY_URL="${BASE_URL}/${BINARY_NAME}"

if [ -w /usr/local/bin ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="${HOME}/bin"
  mkdir -p "$BIN_DIR"
  warn "Add ${BIN_DIR} to your PATH (e.g. export PATH=\"${BIN_DIR}:\$PATH\")"
  export PATH="${BIN_DIR}:${PATH}"
fi
DEST="${BIN_DIR}/prefex"

# Skip download if the remote ETag matches what we cached last time.
ETAG_CACHE="${INSTALL_DIR}/.binary_etag"
REMOTE_ETAG=$(curl -fsSI "${BINARY_URL}" 2>/dev/null | grep -i '^etag:' | tr -d '\r' | awk '{print $2}' || true)
SKIP_DOWNLOAD=false
if [ -f "$DEST" ] && [ -f "$ETAG_CACHE" ] && [ -n "$REMOTE_ETAG" ]; then
  if [ "$REMOTE_ETAG" = "$(cat "$ETAG_CACHE")" ]; then
    info "Binary is already up-to-date — skipping download."
    SKIP_DOWNLOAD=true
  fi
fi

if [ "$SKIP_DOWNLOAD" = "false" ]; then
  info "Downloading ${BINARY_NAME}…"
  mkdir -p "${INSTALL_DIR}/data"
  curl -fsSL "${BINARY_URL}" -o "${DEST}.tmp"

  # SHA256 verification
  CHECKSUM_URL="${BASE_URL}/${BINARY_NAME}.sha256"
  EXPECTED_SHA=$(curl -fsSL "$CHECKSUM_URL" 2>/dev/null | awk '{print $1}' || true)
  if [ -n "$EXPECTED_SHA" ]; then
    if command -v shasum &>/dev/null; then
      ACTUAL_SHA=$(shasum -a 256 "${DEST}.tmp" | awk '{print $1}')
    elif command -v sha256sum &>/dev/null; then
      ACTUAL_SHA=$(sha256sum "${DEST}.tmp" | awk '{print $1}')
    else
      ACTUAL_SHA=""
    fi
    if [ -n "$ACTUAL_SHA" ] && [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
      rm -f "${DEST}.tmp"
      die "SHA256 mismatch! Expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}. Aborted."
    fi
    info "SHA256 verified."
  fi

  chmod +x "${DEST}.tmp"
  mv "${DEST}.tmp" "$DEST"
  [ -n "$REMOTE_ETAG" ] && printf '%s' "$REMOTE_ETAG" > "$ETAG_CACHE"
fi

if [ "$UPGRADE" = "true" ] && [ -f "${INSTALL_DIR}/data/prefex.db" ]; then
  info "Existing database preserved at ${INSTALL_DIR}/data/prefex.db"
fi
info "Binary → ${DEST}"

# ── Configure via binary subcommand ──────────────────────────────────────────
# The binary owns the install lifecycle from here:
#   - writes ~/.prefex/config.yaml (or patches bind/port on upgrade)
#   - backs up and wires ~/.claude/settings.json
# See: prefex install --help

INSTALL_FLAGS="--bind ${PREFEX_BIND} --port ${PREFEX_PORT}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && INSTALL_FLAGS="$INSTALL_FLAGS --anthropic-key ${ANTHROPIC_API_KEY}"

# ── Beta notice ───────────────────────────────────────────────────────────────

printf "${YELLOW}  ⚠  Prefex is beta software — use at your own risk.${RESET}\n"
printf "     Provided as-is with no warranty. Not affiliated with Anthropic.\n"
printf "     Advanced features (thinking, CoD, loop guard) are disabled by default; enable via the dashboard.\n\n"

# ── Preview: show exactly what install will change, then confirm ──────────────

heading "What will change"
"${DEST}" preview --bind "${PREFEX_BIND}" --port "${PREFEX_PORT}" || true
echo ""
printf "  Proceed with install? [Y/n] "
if [ ! -t 0 ]; then
  echo "y (non-interactive)"
  CONFIRM="y"
else
  read -r CONFIRM
fi
case "${CONFIRM:-y}" in
  [Nn]*) printf "\n  Aborted — nothing was changed.\n\n"; exit 0 ;;
esac

# Only NOW stop the running instance and suspend routing —
# after the user has seen the preview and confirmed.
if [ "$UPGRADE" = "true" ]; then
  suspend_routing
  stop_existing
fi

info "Configuring (prefex install ${INSTALL_FLAGS})…"
"${DEST}" install ${INSTALL_FLAGS}

# ── Start the daemon ──────────────────────────────────────────────────────────

info "Starting Prefex…"
nohup "${DEST}" serve \
  -config "${INSTALL_DIR}/config.yaml" \
  -db     "${INSTALL_DIR}/data/prefex.db" \
  > "${INSTALL_DIR}/prefex.log" 2>&1 &
echo $! > "${INSTALL_DIR}/prefex.pid"

# Wait for health check.
printf "  Waiting for proxy"
for i in $(seq 1 30); do
  if curl -fsSo /dev/null "${PROXY_URL}/health" 2>/dev/null; then
    printf " ready.\n"
    break
  fi
  printf "."
  sleep 1
done
if ! curl -fsSo /dev/null "${PROXY_URL}/health" 2>/dev/null; then
  printf "\n"
  warn "Proxy did not respond within 30 s — it may still be starting."
  warn "Check: tail -f ${INSTALL_DIR}/prefex.log"
  warn "If it started, the install completed successfully — run: prefex status"
fi

# ── Capture installed version ─────────────────────────────────────────────────
INSTALLED_VERSION=$("${DEST}" -version 2>/dev/null | awk '{print $2}' || true)

# ── Status-line dependency check ─────────────────────────────────────────────
# `prefex install` already wrote ~/.prefex/statusline.sh and wired the
# statusLine key into ~/.claude/settings.json. The script needs `jq` and
# `curl` at runtime — warn the user if jq is missing so they can install it.
# Settings are added regardless; statusline will start working once jq lands.
if ! command -v jq &>/dev/null; then
  echo ""
  warn "Status-line wired, but \`jq\` is not installed."
  case "$OS" in
    darwin) echo "  Install with:  brew install jq" ;;
    linux)
      if   command -v apt-get &>/dev/null; then echo "  Install with:  sudo apt-get install -y jq"
      elif command -v dnf     &>/dev/null; then echo "  Install with:  sudo dnf install -y jq"
      elif command -v yum     &>/dev/null; then echo "  Install with:  sudo yum install -y jq"
      elif command -v pacman  &>/dev/null; then echo "  Install with:  sudo pacman -S --noconfirm jq"
      elif command -v apk     &>/dev/null; then echo "  Install with:  sudo apk add jq"
      else echo "  Install jq from your package manager or https://jqlang.org/download/"
      fi
      ;;
  esac
  echo "  After installing, statusline will appear in your next Claude Code session."
  echo ""
fi

# ── Done ─────────────────────────────────────────────────────────────────────

curl -sf "${SITE_URL}/api/ping?v=${INSTALLED_VERSION:-latest}&os=${OS}&arch=${ARCH}&e=$([ "$UPGRADE" = "true" ] && echo upgrade || echo install)" >/dev/null 2>&1 &

if [ "$UPGRADE" = "true" ]; then
  heading "Prefex upgraded to ${INSTALLED_VERSION:-latest} (Beta)"
else
  heading "Prefex installed — ${INSTALLED_VERSION:-latest} (Beta)"
fi
echo ""
echo "  Dashboard:  ${PROXY_URL}/dashboard"
echo "  Preview:    prefex preview"
echo "  Benchmark:  curl -fsSL ${SITE_URL}/prefex-bench.sh | bash"
echo ""
echo "  Enabled:  routing · caching · compression · session memory · GC · file cache · bloat guard · token trap"
echo "  Opt-in:   thinking · CoD · loop guard · sawtooth  (enable via Settings tab in the dashboard)"
echo ""
echo "  Privacy: Prefex never logs prompt or response text."
echo "  Verify:  ${SITE_URL}/trust"
echo ""
printf "${YELLOW}  Beta software — use at your own risk. No warranty.${RESET}\n"
printf "${YELLOW}  Not affiliated with Anthropic.${RESET}\n"
printf "\n"
printf "${YELLOW}  To uninstall:${RESET}  prefex uninstall\n"
printf "               or: curl -fsSL ${SITE_URL}/uninstall.sh | bash\n"
echo ""

printf "  Open dashboard in browser? [Y/n] "
if [ ! -t 0 ]; then
  echo "y (non-interactive)"
  REPLY="y"
else
  read -r REPLY
fi
case "${REPLY:-y}" in
  [Yy]*|"")
    if command -v open &>/dev/null; then
      open "${PROXY_URL}/dashboard"
    elif command -v xdg-open &>/dev/null; then
      xdg-open "${PROXY_URL}/dashboard"
    fi
    ;;
esac

