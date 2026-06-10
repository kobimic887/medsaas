// Pure rendering test for company-branded email templates (no server boot, no MongoDB).
// Proves custom-vs-default inline brand colour for all branded templates plus fail-open
// behaviour on a malformed palette. Follows the Phase 2 branding check()-style harness.

import {
  generateVerificationEmailHTML,
  generateWelcomeEmailHTML,
  generatePasswordResetEmailHTML,
  generateInviteEmailHTML,
} from '../utils/emailTemplates.js';
import { DEFAULT_BRAND_PALETTE } from '../utils/companyBranding.js';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  PASS ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
    failed += 1;
  }
}

const CUSTOM_PALETTE = { primary: '#123456', accent: '#223344', light: '#ABCDEF', dark: '#010203' };
const DEFAULT_PRIMARY = DEFAULT_BRAND_PALETTE.primary; // #B4B239

// A hex must appear inside a style="..." attribute (case-insensitive).
function styleContainsHex(html, hex) {
  return new RegExp(`style="[^"]*${hex}`, 'i').test(html);
}

// None of these leak markers may appear in rendered no-palette HTML.
function hasLeakMarker(html) {
  if (/undefined/.test(html)) return 'literal "undefined"';
  if (/linear-gradient\([^)]*,\s*\)/.test(html)) return 'empty gradient';
  // A bare "#" leaked as a colour value: appears after a CSS colour/background
  // declaration (e.g. `color: #;` or `... #%;`) or as a dangling gradient stop.
  // An empty href="#" is a legitimate placeholder link, not a colour leak.
  if (/(?:color|background)\s*:[^";]*#\s*(?:[;"]|0%|100%)/i.test(html)) return 'bare "#" colour';
  return null;
}

// Each template is exercised with the same shape: a custom-palette render and a
// no-options render. The render() closures hide the per-function argument arity.
const TEMPLATES = [
  {
    name: 'generateVerificationEmailHTML',
    renderCustom: () => generateVerificationEmailHTML('user', 'http://x', { palette: CUSTOM_PALETTE }),
    renderDefault: () => generateVerificationEmailHTML('user', 'http://x', {}),
    renderMalformed: () => generateVerificationEmailHTML('user', 'http://x', { palette: { primary: 'not-a-hex' } }),
  },
  {
    name: 'generateWelcomeEmailHTML',
    renderCustom: () => generateWelcomeEmailHTML('user', { palette: CUSTOM_PALETTE }),
    renderDefault: () => generateWelcomeEmailHTML('user', {}),
    renderMalformed: () => generateWelcomeEmailHTML('user', { palette: { primary: 'not-a-hex' } }),
  },
  {
    name: 'generatePasswordResetEmailHTML',
    renderCustom: () => generatePasswordResetEmailHTML('user', 'http://x', { palette: CUSTOM_PALETTE }),
    renderDefault: () => generatePasswordResetEmailHTML('user', 'http://x', {}),
    renderMalformed: () => generatePasswordResetEmailHTML('user', 'http://x', { palette: { primary: 'not-a-hex' } }),
  },
  {
    name: 'generateInviteEmailHTML',
    renderCustom: () => generateInviteEmailHTML({
      invitee: 'newuser', inviter: 'admin', companyName: 'Acme', role: 'member',
      passwordLine: 'Temporary password: x', signInUrl: 'http://x', palette: CUSTOM_PALETTE,
    }),
    renderDefault: () => generateInviteEmailHTML({
      invitee: 'newuser', inviter: 'admin', companyName: 'Acme', role: 'member',
      passwordLine: 'Temporary password: x', signInUrl: 'http://x',
    }),
    renderMalformed: () => generateInviteEmailHTML({
      invitee: 'newuser', inviter: 'admin', companyName: 'Acme', role: 'member',
      passwordLine: 'Temporary password: x', signInUrl: 'http://x',
      palette: { primary: 'not-a-hex' },
    }),
  },
];

console.log('Email theming — inline brand colour rendering:\n');

for (const tpl of TEMPLATES) {
  console.log(`${tpl.name}:`);

  // (a) custom palette renders the custom primary hex inside a style attribute
  const customHtml = tpl.renderCustom();
  check(
    `${tpl.name} custom primary inline`,
    styleContainsHex(customHtml, CUSTOM_PALETTE.primary)
  );

  // (b) no palette renders the DEFAULT_BRAND_PALETTE primary inside a style attribute
  const defaultHtml = tpl.renderDefault();
  check(
    `${tpl.name} default primary inline`,
    styleContainsHex(defaultHtml, DEFAULT_PRIMARY)
  );

  // (c) no-palette HTML contains no leak markers
  const leak = hasLeakMarker(defaultHtml);
  check(`${tpl.name} no-palette HTML has no leaked colour`, leak === null, leak || '');

  // fail-open: a malformed palette does not throw and still yields a style-attribute hex
  let malformedHtml = '';
  let threw = false;
  try {
    malformedHtml = tpl.renderMalformed();
  } catch (error) {
    threw = true;
    console.log(`    (threw: ${error.message})`);
  }
  check(
    `${tpl.name} malformed palette fails open (no throw, default hex inline)`,
    !threw && styleContainsHex(malformedHtml, DEFAULT_PRIMARY)
  );

  console.log('');
}

// CR-01 regression: caller-supplied text must be HTML-escaped in every template.
console.log('HTML injection (CR-01):');
const EVIL_NAME = 'Acme</title><img src=x onerror="alert(1)">';
const INJECTION_RENDERS = [
  ['generateVerificationEmailHTML', generateVerificationEmailHTML(EVIL_NAME, 'http://x', { companyName: EVIL_NAME })],
  ['generateWelcomeEmailHTML', generateWelcomeEmailHTML(EVIL_NAME, { companyName: EVIL_NAME })],
  ['generatePasswordResetEmailHTML', generatePasswordResetEmailHTML(EVIL_NAME, 'http://x', { companyName: EVIL_NAME })],
  ['generateInviteEmailHTML', generateInviteEmailHTML({
    invitee: EVIL_NAME, inviter: EVIL_NAME, companyName: EVIL_NAME,
    role: EVIL_NAME, passwordLine: EVIL_NAME, signInUrl: 'http://x',
  })],
];
for (const [name, html] of INJECTION_RENDERS) {
  check(
    `${name} escapes injected markup`,
    !html.includes('<img src=x') && !html.includes('onerror="alert(1)"') && html.includes('&lt;img src=x')
  );
}
console.log('');

console.log('='.repeat(48));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(48));
process.exitCode = failed > 0 ? 1 : 0;
