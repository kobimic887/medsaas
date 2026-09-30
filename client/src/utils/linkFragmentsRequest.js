// Caller owns cancellation and authentication; this helper bounds request time
// and preserves server validation errors without retrying another source.
export async function linkFragmentsRequest(url, { controller, token, body, timeout = 30000 }) {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`));
    return data;
  } catch (error) {
    if (timedOut) throw new Error('The request timed out. Please try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
