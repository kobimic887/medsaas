import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const GROMACS_API_BASE = (process.env.GROMACS_API_BASE || 'http://localhost:8001').replace(/\/$/, '');
const GLIOBLASTOMA_API_BASE = (process.env.GLIOBLASTOMA_API_BASE || 'http://localhost:5000').replace(/\/$/, '');

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

    // Remap an upstream 401 to 502: the caller already passed our auth, so a
    // 401 here means the SERVICE's credentials failed, not the user's session.
    // Forwarding 401 verbatim would trip the client's auth interceptor and log
    // the user out for an upstream problem.
    return res.status(response.status === 401 ? 502 : response.status).send(payload);
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

  for (const [name, baseUrl, path] of [
    ['gromacs', GROMACS_API_BASE, '/health'],
    ['glioblastoma', GLIOBLASTOMA_API_BASE, '/health'],
  ]) {
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

router.post('/glioblastoma/predict', async (req, res) => {
  return proxyJson(req, res, `${GLIOBLASTOMA_API_BASE}/predict`, { method: 'POST' });
});

router.post('/glioblastoma/batch-predict', async (req, res) => {
  return proxyJson(req, res, `${GLIOBLASTOMA_API_BASE}/batch_predict`, { method: 'POST' });
});

router.get('/gromacs/health', async (req, res) => {
  return proxyJson(req, res, `${GROMACS_API_BASE}/health`, { method: 'GET' });
});

router.get('/gromacs/info', async (req, res) => {
  return proxyJson(req, res, `${GROMACS_API_BASE}/info`, { method: 'GET' });
});

router.post('/gromacs/workflows/:workflow', async (req, res) => {
  const { workflow } = req.params;
  return proxyJson(req, res, `${GROMACS_API_BASE}/workflows/${workflow}`, { method: 'POST' });
});

router.get('/gromacs/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  return proxyJson(req, res, `${GROMACS_API_BASE}/jobs/${jobId}`, { method: 'GET' });
});

export default router;
