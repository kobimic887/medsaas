#!/usr/bin/env python3
"""Second pass on stripe-server.cjs: make the rate limiter see the real client.

The first pass keyed on `req.ip`, which behind nginx -> Vite -> :3001 is 127.0.0.1 for
*every* visitor. That is worse than no limit: five requests from one person locks the
contact form for everybody. Confirmed by hitting the public site and getting a 429 that
belonged to a probe made over the loopback.

nginx sets `X-Real-IP: $remote_addr` unconditionally, so it cannot be spoofed by the
caller — unlike `X-Forwarded-For`, which is built with `$proxy_add_x_forwarded_for` and
therefore carries whatever the client sent, with the real address appended last.

Two buckets, because either alone is wrong:
  - per client IP, 5 / 15 min  — stops one person hammering it
  - global,        40 / 15 min — stops a spoofed or distributed flood from reaching SMTP

Idempotent.
"""
import re, shutil, sys, time
from pathlib import Path

p = Path("/root/material-tailwind-dashboard-react/stripe-server.cjs")
src = p.read_text()

if "_clientKey" in src:
    print("already applied, nothing to do")
    sys.exit(0)
if "function mailRateLimit" not in src:
    print("first pass has not been applied", file=sys.stderr)
    sys.exit(1)

shutil.copy2(p, p.with_suffix(f".cjs.bak-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"))

old = re.compile(
    r"const _mailHits = new Map\(\);\n"
    r"function mailRateLimit\(req, res, next\) \{\n"
    r".*?\n\}\n",
    re.S,
)

new = '''const _mailHits = new Map();
let _mailGlobal = [];

// nginx sets X-Real-IP from $remote_addr and overwrites anything the caller sent, so it
// is the only forwarded header here that can be trusted. X-Forwarded-For is built with
// $proxy_add_x_forwarded_for, which appends to whatever the client supplied.
function _clientKey(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return (req.ip || req.connection?.remoteAddress || 'unknown').replace('::ffff:', '');
}

function mailRateLimit(req, res, next) {
  const WINDOW_MS = 15 * 60 * 1000;
  const PER_IP = 5;
  const GLOBAL = 40;
  const now = Date.now();
  const fresh = (list) => list.filter((t) => now - t < WINDOW_MS);

  _mailGlobal = fresh(_mailGlobal);
  const key = _clientKey(req);
  const hits = fresh(_mailHits.get(key) || []);

  const over = hits.length >= PER_IP ? hits[0] : _mailGlobal.length >= GLOBAL ? _mailGlobal[0] : null;
  if (over !== null) {
    res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - over)) / 1000)));
    return res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
  }

  hits.push(now);
  _mailHits.set(key, hits);
  _mailGlobal.push(now);
  if (_mailHits.size > 5000) {
    for (const [k, v] of _mailHits) if (!fresh(v).length) _mailHits.delete(k);
  }
  next();
}
'''

src2, n = old.subn(lambda _m: new, src, count=1)
assert n == 1, "could not find the first-pass limiter"
p.write_text(src2)
print("patched")
