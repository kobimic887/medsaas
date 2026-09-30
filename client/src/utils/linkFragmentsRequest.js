// Caller owns cancellation and authentication; this helper bounds request time
// and preserves server validation errors without retrying another source.
// Errors carry the HTTP status and service code so callers can tell a gone job
// (404) or a full queue (429) from a transient outage.
// Refinement timeouts nest outward so the innermost layer always answers first:
// service Python child 90 s < server relay 140 s < this browser request 150 s.
// server/test/link-fragments-route.test.mjs pins the ordering.
export const REFINE_REQUEST_TIMEOUT_MS = 150000;

export async function linkFragmentsRequest(url, { controller, token, body, method, timeout = 30000 }) {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(url, {
      method: method || (body ? 'POST' : 'GET'),
      signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`));
      error.status = response.status;
      error.code = data?.code || data?.error?.code || null;
      error.details = Array.isArray(data?.details) ? data.details : Array.isArray(data?.errors) ? data.errors : [];
      // LINK_FRAGMENTS_OWNER_BUSY names the owner's running job so the page can show it.
      error.jobId = typeof data?.jobId === 'string' ? data.jobId : null;
      throw error;
    }
    return data;
  } catch (error) {
    if (timedOut) throw Object.assign(new Error('The request timed out. Please try again.'), { status: 0, code: 'TIMEOUT' });
    throw error;
  } finally { clearTimeout(timer); }
}
