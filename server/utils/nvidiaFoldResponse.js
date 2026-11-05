// NVIDIA's hosted OpenFold3 example polls <invocation-origin>/v1/status/{id}
// after 202. Follow the accepted job with its original key; never POST again.
// https://docs.nvidia.com/nim/bionemo/rfd4-proteina/1.0.0/oracle
export async function completeNvidiaFoldResponse(response, {
  url, key, deadline, get, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
}) {
  if (response.status !== 202) return response;
  const fail = (message, status = 502) => Object.assign(new Error(message), { status, nvidiaAccepted: true });
  const id = response.headers?.['nvcf-reqid'] ?? response.headers?.get?.('nvcf-reqid');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(id)) {
    throw fail('Protein folding accepted the request but returned no valid tracking ID.');
  }
  // Derive only from the configured invocation origin, never a response URL.
  const pollUrl = new URL(`/v1/status/${encodeURIComponent(id)}`, url).href;
  for (let attempt = 0; attempt < 120; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw fail('Protein folding timed out while waiting for its result.', 504);
    try {
      response = await get(pollUrl, { timeout: remaining, maxRedirects: 0,
        maxContentLength: 32 * 1024 * 1024,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'NVCF-POLL-SECONDS': '10' } });
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) throw fail('Protein folding result authentication failed.');
      // Retry GET only for transient failures; the accepted prediction is never resubmitted.
      if (status !== undefined && status !== 429 && status < 500) throw fail('Protein folding could not retrieve its accepted result.');
      response = { status: 202 };
    }
    if (response.status === 200) return response;
    if (response.status !== 202) throw fail('Protein folding returned an unexpected result status.');
    if (deadline - now() <= 1000) throw fail('Protein folding timed out while waiting for its result.', 504);
    await sleep(1000);
  }
  throw fail('Protein folding exceeded the result polling limit.', 504);
}

export function hasFoldCoordinates(data) {
  return Array.isArray(data?.outputs) && data.outputs.some(output => Array.isArray(output?.structures_with_scores)
    && output.structures_with_scores.some(scored => typeof scored?.structure === 'string' && scored.structure.trim()));
}
