#!/usr/bin/env bash
# Install Caddy on the box and put this Caddyfile behind it. Idempotent.
#
#   sudo deploy/box/ingress/install.sh box.example.com ops@example.com
#
# Caddy runs on the HOST under systemd, deliberately — see the Caddyfile header. A Caddy
# container publishing :443 would bypass ufw entirely.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

BOX_DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"

if [ -z "$BOX_DOMAIN" ] || [ -z "$ADMIN_EMAIL" ]; then
  echo "usage: $0 <box-domain> <admin-email>" >&2
  exit 1
fi

case "$BOX_DOMAIN" in
  *.*) ;;
  *) echo "BOX_DOMAIN must be a fully qualified name, got '$BOX_DOMAIN'" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"

# ── DNS first. Without an A record pointing here, ACME fails and Caddy retries in a loop
# that looks like a Caddy problem and is not.
resolved="$(getent hosts "$BOX_DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -z "$resolved" ]; then
  echo "REFUSING: $BOX_DOMAIN does not resolve. Create the A record first." >&2
  exit 1
fi
echo "$BOX_DOMAIN resolves to $resolved"

# ── Caddy from the official repository.
if ! command -v caddy >/dev/null; then
  echo "installing caddy"
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
fi

caddy version

install -d -m 0755 /var/log/caddy
chown caddy:caddy /var/log/caddy

# ── Render the Caddyfile. Placeholders are substituted here rather than templated at run
# time so that what is on disk is exactly what is serving.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sed -e "s|BOX_DOMAIN|${BOX_DOMAIN}|g" -e "s|ADMIN_EMAIL|${ADMIN_EMAIL}|g" \
  "$HERE/Caddyfile" > "$tmp"

if grep -qE 'BOX_DOMAIN|ADMIN_EMAIL' "$tmp"; then
  echo "substitution left a placeholder behind — refusing to install" >&2
  exit 1
fi

if [ -f /etc/caddy/Caddyfile ] && ! cmp -s "$tmp" /etc/caddy/Caddyfile; then
  backup="/etc/caddy/Caddyfile.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp /etc/caddy/Caddyfile "$backup"
  echo "previous Caddyfile saved to $backup"
fi

install -m 0644 "$tmp" /etc/caddy/Caddyfile

# Validate BEFORE restarting, so a typo does not take the ingress down.
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
systemctl --no-pager --lines=10 status caddy || true

cat <<NOTE

Next:

  1. Open the firewall — 443 to 84 only (live app host), 80 to the world for ACME:
       sudo $HERE/firewall.sh 84.13.81.51 <your-admin-ip>

  2. Certificate issuance is not instant. Watch it land:
       journalctl -u caddy -f

  3. Prove it from 84 (live app host), not from here:
       curl -sS https://$BOX_DOMAIN/ingress-health      # -> ok

  4. Prove it is closed from anywhere else:
       curl -sS --max-time 10 https://$BOX_DOMAIN/ingress-health   # must fail

Only then repoint one variable at a time on 84 (ARRIVAL-RUNBOOK Phase 2.5).
NOTE
