import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PORT = 3204;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_NAME = 'medsaas_branding_test';
const PASSWORD = 'BrandingPass1!';
const COMPANY_A = 'company_brand_a';
const COMPANY_B = 'company_brand_b';
const DEFAULT_PRIMARY = '#B4B239';
const HEX = /^#[0-9A-F]{6}$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const BUN_PATH = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
const serverRuntime = process.env.SERVER_RUNTIME || 'bun';
const runtimeBin = serverRuntime === 'bun' ? BUN_PATH : process.execPath;

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealth(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return true;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  return false;
}

function spawnServer(uri) {
  let log = '';
  const child = spawn(runtimeBin, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      MONGODB_URI: uri,
      JWT_SECRET: 'branding_test_jwt_secret_at_least_32_chars',
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_never_calls_api',
      STRIPE_WEBHOOK_SECRET: '',
      FRONTEND_DIST: '',
      PORT: String(PORT),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (data) => { log += data.toString(); });
  child.stderr.on('data', (data) => { log += data.toString(); });
  return { child, getLog: () => log };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGKILL');
  await Promise.race([once(server.child, 'exit'), delay(3000)]);
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function signIn(username) {
  return api('/api/signin', {
    method: 'POST',
    body: { username, password: PASSWORD }
  });
}

async function createLogoUpload() {
  const width = 160;
  const height = 80;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const color = x < width / 2 ? [30, 58, 138] : [245, 158, 11];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return {
    fileName: 'company-logo.png',
    contentType: 'image/png',
    sizeBytes: png.length,
    contentBase64: png.toString('base64')
  };
}

function binaryLength(value) {
  if (Buffer.isBuffer(value)) return value.length;
  if (Buffer.isBuffer(value?.buffer) || value?.buffer instanceof Uint8Array) {
    return value.buffer.length;
  }
  if (typeof value?.value === 'function') {
    return value.value(true)?.length || 0;
  }
  return 0;
}

async function main() {
  console.log(`[branding] runtime: ${serverRuntime} (${runtimeBin})`);
  const memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri(DB_NAME);
  const mongo = new MongoClient(uri);
  let server = null;

  try {
    await mongo.connect();
    const db = mongo.db(DB_NAME);
    const companies = db.collection('companies');
    const users = db.collection('users');
    const auditLogs = db.collection('audit_logs');
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const createdAt = new Date();

    await companies.insertMany([
      {
        companyId: COMPANY_A,
        name: 'Brand Company A',
        slug: 'brand-company-a',
        active: true,
        createdAt,
        updatedAt: createdAt
      },
      {
        companyId: COMPANY_B,
        name: 'Brand Company B',
        slug: 'brand-company-b',
        active: true,
        createdAt,
        updatedAt: createdAt
      }
    ]);

    await users.insertMany([
      {
        username: 'brandowner',
        email: 'brandowner@example.com',
        password: passwordHash,
        verified: true,
        active: true,
        role: 'owner',
        companyId: COMPANY_A,
        companyName: 'Brand Company A',
        simulationTokens: 50,
        createdAt
      },
      {
        username: 'brandadmin',
        email: 'brandadmin@example.com',
        password: passwordHash,
        verified: true,
        active: true,
        role: 'admin',
        companyId: COMPANY_A,
        companyName: 'Brand Company A',
        simulationTokens: 50,
        createdAt
      },
      {
        username: 'brandmember',
        email: 'brandmember@example.com',
        password: passwordHash,
        verified: true,
        active: true,
        role: 'member',
        companyId: COMPANY_A,
        companyName: 'Brand Company A',
        simulationTokens: 50,
        createdAt
      },
      {
        username: 'othermember',
        email: 'othermember@example.com',
        password: passwordHash,
        verified: true,
        active: true,
        role: 'member',
        companyId: COMPANY_B,
        companyName: 'Brand Company B',
        simulationTokens: 50,
        createdAt
      }
    ]);

    server = spawnServer(uri);
    if (!await waitForHealth()) {
      throw new Error(`Server did not become healthy:\n${server.getLog()}`);
    }

    const ownerSignin = await signIn('brandowner');
    const adminSignin = await signIn('brandadmin');
    const memberSignin = await signIn('brandmember');
    const otherSignin = await signIn('othermember');
    check('owner signin succeeds', ownerSignin.status === 200, JSON.stringify(ownerSignin.body));
    check('admin signin succeeds', adminSignin.status === 200, JSON.stringify(adminSignin.body));
    check('member signin succeeds', memberSignin.status === 200, JSON.stringify(memberSignin.body));
    check('second-tenant member signin succeeds', otherSignin.status === 200, JSON.stringify(otherSignin.body));

    const ownerToken = ownerSignin.body.token;
    const adminToken = adminSignin.body.token;
    const memberToken = memberSignin.body.token;
    const otherToken = otherSignin.body.token;
    const logoUpload = await createLogoUpload();

    console.log('\nTest 1 - owner/admin extraction succeeds without persistence:');
    const ownerExtract = await api('/api/company/branding/extract', {
      method: 'POST',
      token: ownerToken,
      body: { logoUpload }
    });
    check('owner extraction returns 200', ownerExtract.status === 200, JSON.stringify(ownerExtract.body));
    check(
      'owner extraction returns four uppercase hex colors',
      ['primary', 'accent', 'light', 'dark'].every((field) => HEX.test(ownerExtract.body.palette?.[field])),
      JSON.stringify(ownerExtract.body)
    );
    const adminExtract = await api('/api/company/branding/extract', {
      method: 'POST',
      token: adminToken,
      body: { logoUpload }
    });
    check('admin extraction returns 200', adminExtract.status === 200, JSON.stringify(adminExtract.body));
    const afterExtraction = await companies.findOne({ companyId: COMPANY_A });
    check('extraction does not persist branding', afterExtraction.branding === undefined);

    console.log('\nTest 2 - members cannot extract or save branding:');
    const memberExtract = await api('/api/company/branding/extract', {
      method: 'POST',
      token: memberToken,
      body: { logoUpload }
    });
    check('member extraction returns 403', memberExtract.status === 403, JSON.stringify(memberExtract.body));
    const memberPatch = await api('/api/company/branding', {
      method: 'PATCH',
      token: memberToken,
      body: { palette: ownerExtract.body.palette }
    });
    check('member save returns 403', memberPatch.status === 403, JSON.stringify(memberPatch.body));

    console.log('\nTest 3 - invalid type, base64, and oversized input are rejected:');
    const invalidType = await api('/api/company/branding/extract', {
      method: 'POST',
      token: ownerToken,
      body: {
        logoUpload: {
          fileName: 'logo.gif',
          contentType: 'image/gif',
          sizeBytes: 4,
          contentBase64: 'R0lG'
        }
      }
    });
    check('invalid MIME returns 400 with a clear error', invalidType.status === 400 && /PNG, JPG, or SVG/.test(invalidType.body.error));
    const invalidBase64 = await api('/api/company/branding/extract', {
      method: 'POST',
      token: ownerToken,
      body: {
        logoUpload: {
          fileName: 'logo.png',
          contentType: 'image/png',
          sizeBytes: 3,
          contentBase64: '***='
        }
      }
    });
    check('invalid base64 returns 400', invalidBase64.status === 400 && /base64/.test(invalidBase64.body.error));
    const oversizedBytes = Buffer.alloc(MAX_LOGO_BYTES + 1);
    const oversized = await api('/api/company/branding/extract', {
      method: 'POST',
      token: ownerToken,
      body: {
        logoUpload: {
          fileName: 'large.png',
          contentType: 'image/png',
          sizeBytes: oversizedBytes.length,
          contentBase64: oversizedBytes.toString('base64')
        }
      }
    });
    check('oversized decoded upload returns 400', oversized.status === 400 && /5 MB/.test(oversized.body.error));

    console.log('\nTest 4 - palette-only save persists without a logo:');
    const manualPalette = {
      primary: '#123456',
      accent: '#ABCDEF',
      light: '#F0F1F2',
      dark: '#101112'
    };
    const paletteOnly = await api('/api/company/branding', {
      method: 'PATCH',
      token: ownerToken,
      body: { palette: manualPalette }
    });
    check('palette-only save returns 200', paletteOnly.status === 200, JSON.stringify(paletteOnly.body));
    const afterPaletteOnly = await companies.findOne({ companyId: COMPANY_A });
    check('palette-only save persists exact palette', afterPaletteOnly.branding?.palette?.primary === manualPalette.primary);
    check('palette-only save does not create a logo', afterPaletteOnly.branding?.logo === undefined);

    console.log('\nTest 5 - logo save uses BSON binary and excludes base64 from Mongo/audit:');
    const logoSave = await api('/api/company/branding', {
      method: 'PATCH',
      token: ownerToken,
      body: { palette: ownerExtract.body.palette, logoUpload }
    });
    check('logo and palette save returns 200', logoSave.status === 200, JSON.stringify(logoSave.body));
    check('save response contains a normalized PNG data URL', logoSave.body.branding?.logo?.dataUrl?.startsWith('data:image/png;base64,'));
    const persisted = await companies.findOne({ companyId: COMPANY_A });
    check('logo bytes persist as BSON binary', binaryLength(persisted.branding?.logo?.data) > 0);
    check('durable logo has no contentBase64 field', persisted.branding?.logo?.contentBase64 === undefined);
    const audit = await auditLogs.findOne({ action: 'company.branding.update' }, { sort: { timestamp: -1 } });
    const auditJson = JSON.stringify(audit?.details || {});
    check('audit metadata excludes image/base64 bytes', !/contentBase64|dataUrl|\"data\"/.test(auditJson));

    console.log('\nTest 6 - palette-only update preserves the existing logo:');
    const storedLogoLength = binaryLength(persisted.branding.logo.data);
    const paletteUpdate = await api('/api/company/branding', {
      method: 'PATCH',
      token: adminToken,
      body: { palette: manualPalette }
    });
    check('admin palette-only update returns 200', paletteUpdate.status === 200, JSON.stringify(paletteUpdate.body));
    const afterPaletteUpdate = await companies.findOne({ companyId: COMPANY_A });
    check('palette-only update preserves logo bytes', binaryLength(afterPaletteUpdate.branding?.logo?.data) === storedLogoLength);

    console.log('\nTest 7 - authenticated reads are tenant isolated:');
    const memberGet = await api('/api/company/branding', { token: memberToken });
    check('same-tenant member can read saved branding', memberGet.status === 200 && memberGet.body.branding?.palette?.primary === manualPalette.primary);
    check('same-tenant member receives saved logo', memberGet.body.branding?.logo?.dataUrl?.startsWith('data:image/png;base64,'));
    const otherGet = await api('/api/company/branding', { token: otherToken });
    check('other tenant receives default palette', otherGet.status === 200 && otherGet.body.branding?.palette?.primary === DEFAULT_PRIMARY);
    check('other tenant receives no logo or custom flag', otherGet.body.branding?.logo === null && otherGet.body.branding?.isCustom === false);

    console.log('\nTest 8 - branding survives a server restart and database re-read:');
    await stopServer(server);
    server = spawnServer(uri);
    if (!await waitForHealth()) {
      throw new Error(`Restarted server did not become healthy:\n${server.getLog()}`);
    }
    const restartedSignin = await signIn('brandowner');
    const restartedGet = await api('/api/company/branding', { token: restartedSignin.body.token });
    check('owner can sign in after restart', restartedSignin.status === 200, JSON.stringify(restartedSignin.body));
    check('saved palette survives restart', restartedGet.body.branding?.palette?.primary === manualPalette.primary);
    check('saved logo survives restart', restartedGet.body.branding?.logo?.dataUrl?.startsWith('data:image/png;base64,'));
  } finally {
    await stopServer(server);
    await mongo.close().catch(() => {});
    await memoryServer.stop().catch(() => {});
  }

  console.log(`\n${'='.repeat(48)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[branding] Harness error:', error);
  process.exit(1);
});
