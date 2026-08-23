/**
 * Bounded retry for flaky upstream HTTP (ASINEX catalog, etc.).
 * Retries only on network/timeout failures and upstream 5xx.
 * Never retries 4xx (including upstream 401 — callers still map that via relayUpstreamStatus).
 */

export function safeUpstreamUrl(url) {
  try {
    const parsed = new URL(String(url));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url).replace(/\?.*$/, '').replace(/#.*$/, '');
  }
}

export function isRetryableUpstreamStatus(status) {
  const code = Number(status);
  return Number.isFinite(code) && code >= 500 && code <= 599;
}

export function isRetryableUpstreamError(error) {
  if (!error) return false;
  const name = error.name || '';
  const message = String(error.message || error);
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  if (error.type === 'request-timeout' || error.type === 'system') return true;
  // node-fetch / undici network phrasing
  if (/fetch failed|network|ECONN|ETIMEDOUT|socket hang up|premature close/i.test(message)) {
    return true;
  }
  return false;
}

export function upstreamRetryDelayMs(attempt, { baseMs = 250, maxMs = 2000 } = {}) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(baseMs * 2 ** (n - 1), maxMs);
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} opts
 * @param {object} [options]
 * @param {(url: string, opts: object) => Promise<Response>} [options.fetchImpl]
 * @param {number} [options.maxAttempts]
 * @param {number} [options.baseDelayMs]
 * @param {number} [options.maxDelayMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {(msg: string) => void} [options.log]
 */
export async function fetchWithUpstreamRetry(url, opts = {}, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    maxAttempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 2000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.warn,
  } = options;

  const label = safeUpstreamUrl(url);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, opts);
      if (!isRetryableUpstreamStatus(response.status) || attempt === maxAttempts) {
        if (isRetryableUpstreamStatus(response.status)) {
          log(`[upstream-retry] give-up status=${response.status} attempt=${attempt} url=${label}`);
        }
        return response;
      }
      log(`[upstream-retry] retry status=${response.status} attempt=${attempt}/${maxAttempts} url=${label}`);
      // Drain so keep-alive sockets are not left half-read before the next try.
      try {
        await response.arrayBuffer();
      } catch {
        /* ignore */
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableUpstreamError(error)) {
        throw error;
      }
      log(
        `[upstream-retry] retry error=${error.name || 'Error'}:${String(error.message || error).slice(0, 120)} attempt=${attempt}/${maxAttempts} url=${label}`
      );
    }

    await sleep(upstreamRetryDelayMs(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs }));
  }

  throw lastError || new Error(`Upstream request failed after ${maxAttempts} attempts`);
}
