import nodemailer from 'nodemailer';

/**
 * Outbound mail: invites, password resets, and the public contact form.
 *
 * ## The provider is not Titan, and hardcoding it broke the contact form
 *
 * Every config in this file used to be `smtp.titan.email`, with the real host appearing
 * once, by accident, in the first entry. Production actually sends through
 * **`server028.yourhosting.nl:587`** — verified against the live credentials on
 * 2026-07-29, where Titan on both 465 and 587 answered `535 5.7.8 authentication failed`
 * and the yourhosting host verified immediately.
 *
 * That mistake had already broken something: `stripe-server.cjs` on 83, which serves the
 * marketing site's contact form, hardcoded Titan 465 with no fallback, so **every contact
 * submission since that page shipped has failed** and the visitor saw a generic error.
 *
 * So the host now comes from the environment. `EMAIL_HOST` and `EMAIL_PORT` are what
 * production has always had in its `.env` and what this file used to ignore.
 *
 * ## Why there is still a fallback list
 *
 * A wrong port is a silent, total outage of every transactional email, and nobody notices
 * until a user cannot reset their password. Trying the configured transport first and a
 * couple of well-known shapes after is cheap insurance. What changed is the order and the
 * cost: the configured one goes first, so the normal path is one connection, not four
 * failures and a success.
 *
 * ## Two things that were actively harmful and are gone
 *
 * - **`debug: true, logger: true`** on every transport. That prints the whole SMTP
 *   conversation, including the `AUTH PLAIN` line, which is the base64 of user and
 *   password. Every send wrote the mailbox credentials into the log. Now opt-in via
 *   `EMAIL_DEBUG=1`, and it should stay off.
 * - **`tls: { rejectUnauthorized: false }`** everywhere, which accepts any certificate
 *   and hands those same credentials to anyone who can intercept the connection. TLS is
 *   verified by default; `EMAIL_TLS_INSECURE=1` restores the old behaviour for a host with
 *   a genuinely broken certificate, and says what it is doing.
 */

const DEBUG = process.env.EMAIL_DEBUG === '1';
const INSECURE_TLS = process.env.EMAIL_TLS_INSECURE === '1';

function tlsOptions(extra = {}) {
  // Verification on unless explicitly disabled. These credentials are worth protecting:
  // the account they open sends mail as the company.
  return { rejectUnauthorized: !INSECURE_TLS, ...extra };
}

/**
 * Strip stray surrounding quotes from the mail settings, once, at import.
 *
 * Production spent time with `EMAIL_HOST= "server028.yourhosting.nl` in its .env —
 * a leading space and an opening double quote, no closing one. dotenv only strips
 * quotes when they *match*, so the value survived as `"server028.yourhosting.nl`
 * and every send died on `getaddrinfo ENOTFOUND`. EMAIL_USER and EMAIL_PASS were
 * quoted the same way, so even a corrected host would have failed authentication.
 *
 * The failure mode is silent and total: no mail at all, and nothing in the logs
 * that names the cause. Trimming here is cheap; the warning is the real point, so
 * a malformed .env announces itself instead of looking like a dead mail server.
 */
function normalizeMailEnv() {
  for (const key of ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM', 'CONTACT_RECIPIENT']) {
    const raw = process.env[key];
    if (typeof raw !== 'string') continue;
    const cleaned = raw.trim().replace(/^["']+/, '').replace(/["']+$/, '');
    if (cleaned !== raw) {
      // Never log the value — one of these is the mailbox password.
      console.warn(`[email] ${key} had surrounding whitespace or quotes in the environment; using the stripped value. Fix it in .env.`);
      process.env[key] = cleaned;
    }
  }
}
normalizeMailEnv();

/**
 * Transports to try, best first.
 *
 * The configured one is first and is normally the only one used. The rest exist so a
 * missing or stale EMAIL_PORT degrades to a slow send rather than to silence.
 */
function buildConfigs() {
  const host = (process.env.EMAIL_HOST || '').trim();
  const port = Number.parseInt(process.env.EMAIL_PORT || '', 10);
  const configs = [];

  if (host) {
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 587;
    configs.push({
      name: `configured ${host}:${resolvedPort}`,
      host,
      port: resolvedPort,
      // 465 is implicit TLS; 587 and 25 negotiate with STARTTLS.
      secure: resolvedPort === 465,
      requireTLS: resolvedPort !== 465,
      tls: tlsOptions(),
      authMethod: 'PLAIN'
    });

    // Same host, the other common port. Covers an EMAIL_PORT that is simply wrong.
    const alternatePort = resolvedPort === 465 ? 587 : 465;
    configs.push({
      name: `configured ${host}:${alternatePort} (fallback)`,
      host,
      port: alternatePort,
      secure: alternatePort === 465,
      requireTLS: alternatePort !== 465,
      tls: tlsOptions(),
      authMethod: 'PLAIN'
    });
  } else {
    console.error(
      '[email] EMAIL_HOST is not set. Falling back to the host production has always used. ' +
      'Set EMAIL_HOST and EMAIL_PORT — see .env.example.'
    );
  }

  // Last resort, and only if it is not already the configured host. This is the host
  // production actually sends through, verified against the live credentials on 2026-07-29.
  // It is a legacy default in the same sense as the Asinex URLs in the chem_beo patch: an env
  // var defaulting to today's value. It is deliberately NOT smtp.titan.email — every comment
  // in this repo used to say Titan, Titan answers `535 authentication failed` for this
  // account, and falling back to it would turn "EMAIL_HOST unset" into total, silent mail
  // failure rather than a degraded send with a loud log line.
  if (host !== 'server028.yourhosting.nl') {
    configs.push({
      name: 'server028.yourhosting.nl:587 (legacy default — set EMAIL_HOST)',
      host: 'server028.yourhosting.nl',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: tlsOptions(),
      authMethod: 'PLAIN'
    });
  }

  return configs;
}

function transportFor(config) {
  return nodemailer.createTransport({
    ...config,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // Never default-on: this logs the AUTH PLAIN line, i.e. the credentials.
    debug: DEBUG,
    logger: DEBUG
  });
}

function describe(config) {
  return `${config.name} (host ${config.host}, port ${config.port}, secure ${config.secure})`;
}

export async function sendTitanEmail({ subject, message, recipientEmail, htmlContent = null }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS environment variables must be set');
  }

  const configs = buildConfigs();
  const failures = [];

  for (const config of configs) {
    try {
      const transporter = transportFor(config);
      await transporter.verify();

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"${process.env.PLATFORM_NAME || 'Pyxis Discovery'}" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject,
        text: message,
        html: htmlContent || `<div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>${subject}</h2>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p><small>Sent from ${process.env.PLATFORM_NAME || 'Pyxis Discovery'}</small></p>
        </div>`
      });

      // Only on the fallback path, so a working setup stays quiet but a degraded one is
      // visible in the log before it becomes a support ticket.
      if (config !== configs[0]) {
        console.warn(`[email] sent via ${describe(config)} — the configured transport failed. Fix EMAIL_HOST/EMAIL_PORT.`);
      }
      return;
    } catch (error) {
      failures.push(`${config.name}: ${error.message}`);
      if (error.responseCode === 535) {
        console.error(`[email] ${describe(config)} rejected the credentials (535). EMAIL_USER/EMAIL_PASS are wrong for this host.`);
      } else {
        console.error(`[email] ${describe(config)} failed: ${error.message}`);
      }
    }
  }

  // The failure list names hosts and ports only — never the credentials, and never the
  // recipient, which is user data.
  throw new Error(`All email configurations failed. Tried: ${failures.join(' | ')}`);
}

/** Probe the configured transport. Used by the diagnostics route, not by the send path. */
export async function testEmailConfiguration() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return {
      success: false,
      error: 'EMAIL_USER and EMAIL_PASS environment variables must be set',
      details: 'Please check your .env file'
    };
  }

  const configs = buildConfigs();
  const failures = [];

  for (const config of configs) {
    try {
      await transportFor(config).verify();
      return {
        success: true,
        message: `Email configuration working with: ${config.name}`,
        config: config.name,
        host: config.host,
        port: config.port
      };
    } catch (error) {
      failures.push(`${config.name}: ${error.message}`);
    }
  }

  return {
    success: false,
    error: 'All email configurations failed',
    details: failures.join(' | ')
  };
}
