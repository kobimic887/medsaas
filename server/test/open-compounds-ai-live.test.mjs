// Optional live AI round-trip for Open compounds.
// Skips unless LIVE_OPEN_AI_VERIFY=1 and a key is present in the environment.
// Never writes .env. Does not enable paid models unless ALLOW_PAID is set.
//
// Run:
//   LIVE_OPEN_AI_VERIFY=1 OPEN_COMPOUNDS_AI_ENABLED=true \
//     OPEN_COMPOUNDS_AI_PROVIDER=openrouter OPEN_COMPOUNDS_AI_MODEL=openrouter/free \
//     OPEN_COMPOUNDS_AI_API_KEY=… bun server/test/open-compounds-ai-live.test.mjs

import {
  openCompoundsConfig,
} from '../utils/openCompounds.js';
import {
  resolveOpenCompoundsAiRuntime,
  runOpenCompoundsAiSearch,
} from '../utils/openCompoundsAi.js';

const REF = 'c1ccc2c(c1)nc(s2)SCC(=O)O';

if (process.env.LIVE_OPEN_AI_VERIFY !== '1') {
  console.log('[open-ai-live] skipped (set LIVE_OPEN_AI_VERIFY=1 to run a real model call)');
  process.exit(0);
}

const config = openCompoundsConfig(process.env);
const runtime = resolveOpenCompoundsAiRuntime(config.ai, process.env);
if (!runtime.enabled) {
  console.error('[open-ai-live] AI runtime not enabled:', runtime.reason);
  console.error('Provision OPEN_COMPOUNDS_AI_* (and a free model) then re-run. No .env was written.');
  process.exit(2);
}

console.log(`[open-ai-live] provider=${runtime.provider} model=${runtime.model}`);

const result = await runOpenCompoundsAiSearch({
  config,
  runtime,
  params: {
    smiles: REF,
    threshold: 0.7,
    offset: 0,
    limit: 10,
    maxResults: 10,
  },
  instruction: 'Summarize the top validated hits; do not change the query SMILES.',
  fetchImpl: (url, opts = {}) => fetch(url, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || 90000),
  }),
});

if (result.mode !== 'ai') throw new Error('expected mode=ai');
if (!Array.isArray(result.results) || result.results.length < 1) {
  throw new Error('expected tool-backed results');
}
if (result.results[0].chemblId !== 'CHEMBL1373993' && result.results[0].similarity !== 1) {
  // Self-hit should normally be present at 0.7; warn but accept other valid ranks.
  console.warn('[open-ai-live] note: top hit was', result.results[0].chemblId, result.results[0].similarity);
}
if (result.ai?.scoresFrom !== 'rdkit_morgan_tanimoto') {
  throw new Error('scores must declare rdkit source');
}
if (!(result.ai?.toolCalls >= 1)) throw new Error('expected at least one tool call');

console.log(`[open-ai-live] ok — ${result.results.length} results, toolCalls=${result.ai.toolCalls}`);
console.log(`[open-ai-live] top=${result.results[0].chemblId} sim=${result.results[0].similarity}`);
