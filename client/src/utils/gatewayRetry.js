// Retry helper for gateway 5xx while pyxis-web restarts (nginx answers 502/503/504
// with HTML while bun is down). A JSON 5xx is the API's own answer, e.g. a stock
// similarity scan that hit its database time budget or an owned search that
// already waited for its gate; retrying it repeats a ~30 s failure three times
// behind "Searching", so only non-JSON gateway responses are retried.
export function isGatewayRetryable(response) {
  const gatewayStatus = response.status === 502 || response.status === 503 || response.status === 504;
  const contentType = response.headers?.get?.("content-type") || "";
  return gatewayStatus && !contentType.includes("application/json");
}

export async function fetchWithGatewayRetry(url, init = {}, { maxAttempts = 3, baseDelayMs = 400, fetchImpl = fetch } = {}) {
  let lastResponse;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResponse = await fetchImpl(url, init);
    if (!isGatewayRetryable(lastResponse) || attempt === maxAttempts) return lastResponse;
    if (init.signal?.aborted) return lastResponse;
    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }
  return lastResponse;
}
