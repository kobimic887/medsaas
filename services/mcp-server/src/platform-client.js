import { config } from './config.js';

// A missing/blank token is a caller error, not an upstream failure. Callers pass
// their ChemBench platform JWT (from POST /api/signin) either as the MCP
// `authorization_token` (HTTP) or MEDSAAS_TOKEN (stdio).
export class MissingTokenError extends Error {
  constructor() {
    super(
      'No ChemBench platform token provided. Set the MCP authorization_token ' +
        '(hosted) or MEDSAAS_TOKEN (stdio) to a JWT issued by POST /api/signin.',
    );
    this.name = 'MissingTokenError';
  }
}

function buildUrl(path, query) {
  const url = new URL(`${config.apiBase}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

// Calls the ChemBench platform API, forwarding the caller's bearer token. Returns
// a normalized { ok, status, data } — it never throws on an HTTP error status, so
// tool handlers can surface upstream failures back to the model as tool results.
export async function callPlatform({ method = 'GET', path, query, body, token }) {
  if (!token) {
    throw new MissingTokenError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, status: 504, data: { error: 'Upstream request timed out' } };
    }
    return {
      ok: false,
      status: 502,
      data: { error: 'ChemBench platform unreachable', details: error.message },
    };
  } finally {
    clearTimeout(timeout);
  }
}
