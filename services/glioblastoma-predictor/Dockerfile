FROM python:3.14-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy application code
COPY . .

# ── No TLS certificates here, deliberately ───────────────────────────────────
# This used to COPY chemtest_tech_fullchain.crt and chemtest_tech_private.key, a TLS keypair
# for the domain chemtest.tech, left over from when this service was deployed standalone at
# chemtest.tech / 152.42.134.22 and terminated HTTPS itself (app.py:362-425).
#
# That domain has since EXPIRED (owner, 2026-07-30), so the certificate now attests to a name
# nobody controls. Even if you wanted HTTPS here, this keypair could not provide it.
#
# Two reasons that had to go:
#
#  1. It made this the ONE image in deploy/box/compose.yml that a clean checkout cannot
#     build. The key is untracked (.gitignore:45) and correctly so — it is a private key —
#     so `git clone && docker compose build` failed here and nowhere else.
#  2. On the box it is wrong anyway. Services bind 127.0.0.1 and Caddy terminates TLS at
#     :443 (deploy/box/ingress/). A service doing its own TLS behind a reverse proxy means
#     two certificates to renew for one endpoint, and this one is for a domain that has
#     nothing to do with the box.
#
# app.py already falls back to plain HTTP when the files are absent, so nothing else
# changes. If you ever want HTTPS here again, mount the pair at runtime — do not bake a
# private key into an image layer.

EXPOSE 5000

CMD ["python", "app.py"]
