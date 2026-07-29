#!/usr/bin/env python3
"""Third pass: make stripe-server.cjs send through the SMTP host that actually works.

Both mail routes hardcode `smtp.titan.email:465`. Production does not use Titan — the
credentials in the .env belong to `server028.yourhosting.nl:587`, and Titan answers
`535 5.7.8 authentication failed` on 465 and 587 alike. Verified on the box, 2026-07-29.

So the contact form on app.pyxis-discovery.com has never been able to send a message:
every submission failed SMTP auth and the visitor got "Failed to send email."

Reads EMAIL_HOST/EMAIL_PORT, which have been sitting in the .env unused all along.
Idempotent.
"""
import re, shutil, sys, time
from pathlib import Path

p = Path("/root/material-tailwind-dashboard-react/stripe-server.cjs")
src = p.read_text()

if "_smtpConfig" in src:
    print("already applied, nothing to do")
    sys.exit(0)

shutil.copy2(p, p.with_suffix(f".cjs.bak-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"))

helper = '''
// --- SMTP transport, 2026-07-29 -----------------------------------------------
// The two routes below hardcoded smtp.titan.email:465. That is not this account's
// provider: EMAIL_HOST in the .env is server028.yourhosting.nl and Titan rejects these
// credentials with 535 on every port. Every contact-form submission has therefore
// failed since the page shipped. Read the configured host instead.
function _smtpConfig() {
  const host = (process.env.EMAIL_HOST || '').trim();
  const port = Number.parseInt(process.env.EMAIL_PORT || '587', 10);
  if (!host) throw new Error('EMAIL_HOST is not configured');
  return {
    host,
    port,
    secure: port === 465,        // 465 is implicit TLS; 587/25 use STARTTLS
    requireTLS: port !== 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  };
}
// -----------------------------------------------------------------------------
'''

anchor = "const app = express();"
assert anchor in src, "express app not found"
src = src.replace(anchor, anchor + "\n" + helper, 1)

# Replace both hardcoded config literals with a call to the helper.
pattern = re.compile(
    r"    // Official Titan Mail configuration[^\n]*\n"
    r"    const config = \{\s*\n"
    r"      host: 'smtp\.titan\.email',\s*\n"
    r"      port: 465,\s*\n"
    r"      secure: true,[^\n]*\n"
    r"      auth: \{\s*\n"
    r"        user: process\.env\.EMAIL_USER,\s*\n"
    r"        pass: process\.env\.EMAIL_PASS,\s*\n"
    r"      \}\s*\n"
    r"    \};\n"
)
src, n = pattern.subn(lambda _m: "    const config = _smtpConfig();\n", src)
assert n == 2, f"expected 2 hardcoded transports, rewrote {n}"

# The diagnostics route reports which config it used.
src = src.replace("config: 'Titan Mail SSL 465'", "config: `${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT || 587}`", 1)

p.write_text(src)
print(f"patched {n} transports")
