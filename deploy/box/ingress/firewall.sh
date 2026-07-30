#!/usr/bin/env bash
# Host firewall for the box. Idempotent — safe to run again.
#
#   sudo deploy/box/ingress/firewall.sh 83.229.87.94 <your-admin-ip>
#
# Admits :443 from the listed addresses ONLY. Everything else on :443 is dropped, and the
# compute ports are never published to a public interface in the first place — compose binds
# them to ${BIND_ADDR}, which defaults to 127.0.0.1.
#
# ⚠ Include an admin IP as well as 83's. With only 83 allowed, an SSH session from anywhere
# else still works (SSH is opened separately below) but you cannot curl the ingress to debug
# it. Locking yourself out of the diagnostic path on a machine with no on-site service is
# a bad trade.
#
# ⚠ ufw does NOT govern Docker-published ports. Docker inserts its own rules ahead of ufw's,
# so a container published on 0.0.0.0:443 would be world-reachable while `ufw status` still
# said "deny". That is why Caddy runs on the host under systemd and why every compute
# service binds loopback. If you ever publish a container port on this machine, verify from
# OUTSIDE that it is actually closed — do not trust `ufw status`.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <allowed-ip> [more-allowed-ips...]" >&2
  echo "  the first should be 83.229.87.94 (the platform API)" >&2
  exit 1
fi

command -v ufw >/dev/null || { echo "ufw is not installed: apt-get install -y ufw" >&2; exit 1; }

echo "== before =="
ufw status verbose || true

# SSH first, and unconditionally. Enabling ufw with no SSH rule ends the session and the
# machine has pick-up warranty, not on-site service.
ufw allow 22/tcp comment 'ssh'

# Drop any previous :443 grants so removing an IP from the argument list actually removes it.
while read -r number; do
  [ -n "$number" ] && ufw --force delete "$number"
done < <(ufw status numbered | grep -E '443/tcp' | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/' | sort -rn)

for ip in "$@"; do
  echo "allowing $ip -> 443/tcp"
  ufw allow from "$ip" to any port 443 proto tcp comment "box ingress: $ip"
done

# ⚠ Port 80 IS opened to the world, and it has to be. Read this before "hardening" it shut.
#
# Let's Encrypt validates by connecting to the domain FROM ITS OWN SERVERS. If neither :80
# nor :443 is reachable from the internet, no certificate is ever issued and none is ever
# renewed — the box would work for exactly 90 days and then start failing TLS to 83, with
# the cause sixty days in the past.
#
# So one of the two must be open. Opening :80 is strictly the safer choice: the only thing
# Caddy serves there is the ACME challenge and a redirect to HTTPS, whereas opening :443
# would expose every proxied compute route to the whole internet and make the allowlist
# below decorative.
#
# The stricter alternative is the DNS-01 challenge, which needs NO inbound port at all —
# but it needs a Caddy binary built with the DNS provider's plugin and an API token for the
# zone. If the DNS for BOX_DOMAIN is somewhere with a supported provider plugin, switch to
# it and close :80. Until then, this is the correct trade.
ufw allow 80/tcp comment 'ACME HTTP-01 challenge only'

ufw default deny incoming
ufw default allow outgoing
ufw --force enable

echo "== after =="
ufw status verbose

cat <<'NOTE'

Verify from a machine that is NOT on the allow list — `ufw status` is not evidence:

    curl -sS --max-time 10 https://<BOX_DOMAIN>/ingress-health   # must hang or refuse

and from 83:

    curl -sS --max-time 10 https://<BOX_DOMAIN>/ingress-health   # must print: ok
NOTE
