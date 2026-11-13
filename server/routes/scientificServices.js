import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// No default endpoints. The former localhost:8001 default for GROMACS is the
// convertSTR port, so its /health answered 200 and reported a GROMACS service
// that did not exist. An unset base is "not configured" (503), never a guess.
const SERVICE_ENV = { gromacs: 'GROMACS_API_BASE', glioblastoma: 'GLIOBLASTOMA_API_BASE' };
const SERVICE_LABEL = { gromacs: 'GROMACS', glioblastoma: 'Glioblastoma prediction' };

export function serviceBase(name, env = process.env) {
  const raw = String(env[SERVICE_ENV[name]] || '').trim();
  return raw ? raw.replace(/\/$/, '') : null;
}

function refuseNotConfigured(res, name) {
  return res.status(503).json({
    code: 'SERVICE_NOT_CONFIGURED',
    error: `${SERVICE_LABEL[name]} is not configured on this server. No credits were charged.`,
  });
}

function proxyService(name, path, options) {
  return (req, res) => {
    const base = serviceBase(name);
    if (!base) return refuseNotConfigured(res, name);
    return proxyJson(req, res, `${base}${typeof path === 'function' ? path(req) : path}`, options);
  };
}

// Same contract as server/index.js: these proxies already ran authenticateToken,
// so an upstream 401 is the service's credentials failing — never a user session.
// Forwarding 401 would trip the SPA interceptor and log the caller out.
export function relayUpstreamStatus(status) {
  return status === 401 ? 502 : status;
}

async function proxyJson(req, res, targetUrl, options = {}) {
  try {
    const response = await fetch(targetUrl, {
      method: options.method || req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ?? (req.method === 'GET' ? undefined : JSON.stringify(req.body)),
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return res.status(relayUpstreamStatus(response.status)).send(payload);
  } catch (error) {
    console.error(`Proxy error for ${targetUrl}:`, error);
    return res.status(502).json({
      error: 'Upstream scientific service unavailable',
      service: targetUrl,
      details: error.message,
    });
  }
}

router.get('/platform/health', async (_req, res) => {
  const checks = {};

  for (const name of ['gromacs', 'glioblastoma']) {
    const baseUrl = serviceBase(name);
    const path = '/health';
    if (!baseUrl) {
      checks[name] = { status: 'not_configured' };
      continue;
    }
    try {
      const response = await fetch(`${baseUrl}${path}`, { method: 'GET' });
      checks[name] = {
        status: response.ok ? 'healthy' : 'unhealthy',
        baseUrl,
        statusCode: response.status,
      };
    } catch (error) {
      checks[name] = { status: 'unhealthy', baseUrl, error: error.message };
    }
  }

  res.json({ checks, timestamp: new Date().toISOString() });
});

router.post('/glioblastoma/predict', proxyService('glioblastoma', '/predict', { method: 'POST' }));

router.post('/glioblastoma/batch-predict', proxyService('glioblastoma', '/batch_predict', { method: 'POST' }));

router.get('/gromacs/health', proxyService('gromacs', '/health', { method: 'GET' }));

router.get('/gromacs/info', proxyService('gromacs', '/info', { method: 'GET' }));

// Encode path segments so they can't traverse (../) or inject into the
// upstream URL. Restrict to a sane identifier shape as well.
const workflowProxy = proxyService('gromacs', (req) => `/workflows/${encodeURIComponent(req.params.workflow)}`, { method: 'POST' });
router.post('/gromacs/workflows/:workflow', (req, res) => {
  if (!/^[\w.-]{1,128}$/.test(req.params.workflow)) {
    return res.status(400).json({ error: 'Invalid workflow identifier' });
  }
  return workflowProxy(req, res);
});

const jobProxy = proxyService('gromacs', (req) => `/jobs/${encodeURIComponent(req.params.jobId)}`, { method: 'GET' });
router.get('/gromacs/jobs/:jobId', (req, res) => {
  if (!/^[\w.-]{1,128}$/.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid job identifier' });
  }
  return jobProxy(req, res);
});

export default router;
