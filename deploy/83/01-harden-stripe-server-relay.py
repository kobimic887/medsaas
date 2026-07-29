#!/usr/bin/env python3
"""Close the open mail relay in stripe-server.cjs, in place, on 83.

Three changes, each the smallest that removes the abuse without removing the feature:

1. The destination is server-controlled. The route used to send wherever the caller's
   `recipientEmail` pointed, unauthenticated, through the production Titan Mail account —
   an open relay reachable at https://app.pyxis-discovery.com/api/send-email, because
   Vite proxies /api to this process. It now always sends to CONTACT_RECIPIENT/EMAIL_USER
   and treats a caller-supplied address only as the visitor's own reply-to. This mirrors
   server/index.js:5783 exactly, so the behaviour survives Release A unchanged.

2. A rate limit on the two mail routes. 5 requests per 15 minutes per IP, matching this
   repo's publicEmailRateLimit.

3. /api/test-email answers only to localhost. It reported whether credentials were set
   and handed out account-recovery instructions to anyone who asked.

Idempotent: refuses to run twice.
"""
import re, shutil, sys, time
from pathlib import Path

p = Path("/root/material-tailwind-dashboard-react/stripe-server.cjs")
src = p.read_text()

MARK = "// --- hardened 2026-07-29"
if MARK in src:
    print("already hardened, nothing to do")
    sys.exit(0)

backup = p.with_suffix(f".cjs.bak-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}")
shutil.copy2(p, backup)
print(f"backup: {backup}")

# ---- 1. rate limiter, inserted right after the express app is created -------------
limiter = '''
%s ---------------------------------------------------------------
// Both mail routes below are public and hit a real SMTP account, so they get the same
// budget this project's own server gives them (publicEmailRateLimit): 5 per 15 minutes
// per IP. In-memory and per-process, exactly like server/index.js — no new dependency.
const _mailHits = new Map();
function mailRateLimit(req, res, next) {
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX = 5;
  const key = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (_mailHits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX) {
    res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - hits[0])) / 1000)));
    return res.status(429).json({ success: false, error: 'Too many requests. Try again later.' });
  }
  hits.push(now);
  _mailHits.set(key, hits);
  if (_mailHits.size > 5000) {
    for (const [k, v] of _mailHits) if (!v.some((t) => now - t < WINDOW_MS)) _mailHits.delete(k);
  }
  next();
}

// /api/test-email reported whether the mail credentials were set and printed
// account-recovery steps. Diagnostics, not a public endpoint.
function localOnly(req, res, next) {
  const ip = (req.ip || '').replace('::ffff:', '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return next();
  return res.status(404).json({ error: 'Not found' });
}
// -----------------------------------------------------------------------------
''' % MARK

anchor = "const app = express();"
assert anchor in src, "could not find the express app"
src = src.replace(anchor, anchor + "\n" + limiter, 1)

# ---- 2. attach the middleware to the two mail routes ------------------------------
for route, mw in (("/api/test-email", "localOnly"), ("/api/send-email", "mailRateLimit")):
    verb = "get" if route.endswith("test-email") else "post"
    before = f"app.{verb}('{route}', async (req, res) => {{"
    assert before in src, f"route {route} not found"
    src = src.replace(before, f"app.{verb}('{route}', {mw}, async (req, res) => {{", 1)

# ---- 3. pin the destination -------------------------------------------------------
# Matched by regex, not by literal: the file is full of trailing whitespace that an
# exact-string patch trips over.
old_validate = re.compile(
    r"    // Validate required fields\n"
    r"    if \(!name \|\| !subject \|\| !message \|\| !recipientEmail\) \{\s*\n"
    r"      return res\.status\(400\)\.json\(\{\s*\n"
    r"        success: false,\s*\n"
    r"        error: 'All fields including recipient email are required'\s*\n"
    r"      \}\);\s*\n"
    r"    \}\n"
)
new_validate = """    // Validate required fields
    if (!name || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'name, subject, and message are required'
      });
    }

    // SECURITY: this endpoint is public (contact form) and reachable from the internet
    // because Vite proxies /api here. The destination is therefore server-controlled and
    // NOT taken from the request, so it cannot be used to send mail to arbitrary
    // recipients through the production Titan Mail account. Any client-supplied
    // recipientEmail is treated only as the visitor's own reply-to address and shown in
    // the body. Identical to server/index.js:5783, so Release A changes nothing here.
    const destination = process.env.CONTACT_RECIPIENT || process.env.EMAIL_USER;
    if (!destination) {
      console.error('send-email: no CONTACT_RECIPIENT/EMAIL_USER configured');
      return res.status(500).json({ success: false, error: 'Email destination is not configured' });
    }
    const _emailRe = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    const senderContact =
      typeof recipientEmail === 'string' && _emailRe.test(recipientEmail.trim())
        ? recipientEmail.trim()
        : null;
"""
# A lambda replacement, so backslashes in the new code are never read as group refs.
def sub1(pattern, repl, text, what):
    text2, k = re.subn(pattern, lambda _m: repl, text, count=1)
    assert k == 1, f"could not rewrite {what}"
    return text2

src = sub1(old_validate, new_validate, src, "send-email validation block")

src = sub1(r"      to: recipientEmail,", "      to: destination,", src, "recipient")
src = sub1(
    r"        <p><strong>From:</strong> \$\{name\} \(via \$\{process\.env\.EMAIL_FROM\}\)</p>",
    "        <p><strong>From:</strong> ${name}${senderContact ? ` &lt;${senderContact}&gt;` : ''}</p>",
    src, "html from-line")
src = sub1(
    r"        From: \$\{name\} \(via \$\{process\.env\.EMAIL_FROM\}\)",
    "        From: ${name}${senderContact ? ` <${senderContact}>` : ''}",
    src, "text from-line")

p.write_text(src)
print("patched")
