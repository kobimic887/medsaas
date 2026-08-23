# Box ingress — one HTTPS door, one firewall

```bash
sudo deploy/box/ingress/install.sh  box.example.com  ops@example.com
sudo deploy/box/ingress/firewall.sh 84.13.81.51     <your-admin-ip>
```

Then, from 84: `curl https://box.example.com/ingress-health` → `ok`.
From anywhere else: it must fail.

---

## Why any of this is needed

The services behind it are **unauthenticated compute**. There is no login on `:8000` — whoever
reaches the port can dock, on four RTX PRO 4000s. And 83 is in one datacentre while the box is in
another, so the traffic crosses the open internet either way.

That leaves two separate problems, and they need two separate answers:

| Problem | Answer | Why the other one doesn't cover it |
|---|---|---|
| Anyone can use the GPUs | **firewall** — `:443` from 84 only | TLS authenticates the *server* to the client, not the client to the server. It would encrypt a stranger's dock request perfectly |
| Anyone on the path can read and rewrite the traffic | **TLS** | A source-IP allowlist says nothing about who reads the packets in between. Proteins, ligands and results would be plaintext, and a returned pose could be altered without either end noticing |

`chem_beo`'s open `/api/diffdock/generate` is exactly how the NVIDIA quota got drained. This is
the same mistake available again, with more expensive hardware.

It is also **1:1 with what it replaces.** 84 (`pyxis-web`) calls `https://services.asinex.com:58000/…` over
the public internet today. Keeping the shape identical means rollback is putting the Asinex
hostname back in one environment variable — no VPN client to remove, no route to unwind.

## Why Caddy and not nginx

Automatic Let's Encrypt — issuance, renewal, OCSP — with no certbot timer, no renewal hook,
no cron job that quietly stops working. That is the whole reason. nginx proxies just as well
and then needs a second moving part to keep the certificate alive. On a machine with **pick-up
warranty and no on-site service**, where a fault means one to three weeks without it, fewer
moving parts wins.

Rejected earlier and still rejected: **WireGuard/Tailscale**. That was one comment in
`compose.yml` which four documents then cited as a settled decision. It never was
(ARRIVAL-RUNBOOK Phase 3.1).

## Why Caddy runs on the host and not in Docker

⚠ **Docker-published ports bypass ufw.** Docker inserts its own iptables rules ahead of ufw's,
so a Caddy container with `ports: 443:443` would be reachable from the entire internet while
`ufw status` still read `deny`. Under systemd on the host, `:443` is inside the firewall's
jurisdiction. The compute services stay bound to `127.0.0.1` and are never published at all.

If you ever do publish a container port on this machine, **verify from outside** that it is
closed. `ufw status` is not evidence.

## Why port 80 is open to the world

Because Let's Encrypt validates by connecting to the domain **from its own servers**. If
neither `:80` nor `:443` is reachable from the internet, no certificate is issued and none is
renewed — the box would work for exactly 90 days and then start failing TLS to 83, with the
cause two months in the past.

One of the two must be open, and `:80` is the safe one: Caddy serves only the ACME challenge
and a redirect there. Opening `:443` instead would expose every proxied compute route and make
the allowlist decorative.

**The stricter option is DNS-01**, which needs no inbound port at all — but it needs a Caddy
binary built with the DNS provider's plugin (`xcaddy build --with github.com/caddy-dns/…`) and
an API token for the zone. If `BOX_DOMAIN` lives with a supported provider, switch to it and
close `:80`.

## Routes, and the variable each one sets on 84

| Path | → | Platform variable |
|---|---|---|
| `/docking*` | `127.0.0.1:8000` | `ASINEX_DOCKING_API_URL=https://BOX/docking` |
| `/convertSTR*` | `127.0.0.1:8001` | `SDF_CONVERTER_URL=https://BOX/convertSTR` |
| `/molecular-docking/*` | `127.0.0.1:8002` | `DIFFDOCK_API_URL=https://BOX/molecular-docking/diffdock/generate` |
| `/tanimoto/*` | `127.0.0.1:8003` | `TANIMOTO_API_BASE=https://BOX/tanimoto` |
| `/glioblastoma/*` | `127.0.0.1:8005` | `GLIOBLASTOMA_API_BASE=https://BOX/glioblastoma` |
| `/gromacs/*` | `127.0.0.1:8006` | `GROMACS_API_BASE=https://BOX/gromacs` |
| `/ingress-health` | Caddy itself | — |
| anything else | `404` | — |

Tanimoto, GROMACS and glioblastoma use `handle_path`, which **strips** the prefix, because the
platform treats those as a base URL and appends its own paths. Docking, convertSTR and DiffDock
use `handle`, which does **not** strip, because those upstream services expect the full path —
that is what makes the DiffDock cutover a hostname swap and nothing else.

⚠ **DiffDock's route carries NO timeout directive, deliberately** — an earlier draft of this
README said it "gets 600-second proxy timeouts", and the Caddyfile does not. It once carried
`transport http { read_timeout 600s; write_timeout 600s }`, which is **invalid**: those
subdirectives belong to `transport fastcgi`. It is also unnecessary — Caddy's `reverse_proxy`
applies no response timeout unless one is configured, so plain `reverse_proxy` already waits as
long as DiffDock takes, and a 100-pose dock is slow. If a limit is ever wanted, the correct
knob is `response_header_timeout`. See the comment in `Caddyfile`.

## Order of operations

1. DNS `A` record for `BOX_DOMAIN` → the box. `install.sh` refuses to run without it, because
   a missing record makes ACME retry in a loop that looks like a Caddy fault and is not.
2. `install.sh` — validates the config **before** reloading, so a typo cannot take the ingress
   down.
3. `firewall.sh` — pass an **admin IP as well as 84's**. With only 84 allowed you can still SSH
   in but cannot `curl` the ingress to debug it, which is a bad position on a machine with no
   on-site service.
4. Verify from 84 **and** from somewhere else. Both directions, or it is not verified.
5. Only then repoint the platform, one variable at a time (ARRIVAL-RUNBOOK Phase 2.5).
