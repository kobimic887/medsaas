// Open-compounds AI orchestration: model tool-calls → validated ChEMBL/RDKit search.
//
// The model may interpret an optional instruction and MUST call the chemical
// search tool. Final structures, IDs, and Morgan/Tanimoto scores come only from
// the tool path (runOpenCompoundsSearch / RDKit). Model-written similarity
// numbers are never accepted as measured evidence.
//
// Providers are OpenAI-compatible chat-completions endpoints (OpenRouter or
// OpenAI). Paid models require OPEN_COMPOUNDS_AI_ALLOW_PAID=true. Free-tier
// OpenRouter models are preferred when configured with `:free` or
// `openrouter/free`.

import {
  OpenCompoundsUnavailableError,
  OpenCompoundsUpstreamError,
  OpenCompoundsValidationError,
  OPEN_COMPOUNDS_FINGERPRINT,
  OPEN_SIMILARITY_MAX_RESULTS,
  OPEN_SIMILARITY_MIN_THRESHOLD,
  OPEN_SIMILARITY_MAX_THRESHOLD,
  parseOpenCompoundsQuery,
  runOpenCompoundsSearch,
} from './openCompounds.js';

export const OPEN_COMPOUNDS_AI_TOOL_NAME = 'search_similar_open_compounds';
export const OPEN_COMPOUNDS_AI_MAX_ROUNDS = 4;
export const OPEN_COMPOUNDS_AI_MAX_TOOL_CALLS = 2;
export const OPEN_COMPOUNDS_AI_TIMEOUT_MS = 90000;
export const OPEN_COMPOUNDS_AI_MAX_TOKENS = 1200;
export const OPEN_COMPOUNDS_AI_INSTRUCTION_MAX = 500;

/** Allowlisted OpenAI-compatible providers. No arbitrary user URLs. */
export const OPEN_COMPOUNDS_AI_PROVIDERS = Object.freeze({
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    // Measured 2026-09-09 from OpenRouter /api/v1/models: supports tools.
    defaultModel: 'openrouter/free',
    freeModelHint: 'Prefer ids ending in :free, or openrouter/free. Verify tool support before enabling.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    freeModelHint: 'OpenAI has no free tool-calling tier in this integration; requires OPEN_COMPOUNDS_AI_ALLOW_PAID=true.',
  },
});

export class OpenCompoundsAiError extends Error {
  constructor(message, { code = 'OPEN_COMPOUNDS_AI_ERROR', status = 502 } = {}) {
    super(message);
    this.name = 'OpenCompoundsAiError';
    this.code = code;
    this.status = status;
  }
}

export function isLikelyFreeModel(model) {
  const id = String(model || '').trim().toLowerCase();
  if (!id) return false;
  if (id.endsWith(':free')) return true;
  if (id === 'openrouter/free') return true;
  return false;
}

/**
 * Resolve AI runtime settings from openCompoundsConfig().ai + env.
 * Returns { enabled, reason, provider, model, apiKey, baseUrl, allowPaid }.
 */
export function resolveOpenCompoundsAiRuntime(aiConfig, env = process.env) {
  const allowPaid = String(env.OPEN_COMPOUNDS_AI_ALLOW_PAID || '').trim().toLowerCase() === 'true';
  const providerId = String(aiConfig?.provider || env.OPEN_COMPOUNDS_AI_PROVIDER || '')
    .trim()
    .toLowerCase();
  const provider = OPEN_COMPOUNDS_AI_PROVIDERS[providerId] || null;
  const model = String(aiConfig?.model || env.OPEN_COMPOUNDS_AI_MODEL || provider?.defaultModel || '')
    .trim() || null;
  const apiKey = String(
    env.OPEN_COMPOUNDS_AI_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || ''
  ).trim();
  const configured = String(env.OPEN_COMPOUNDS_AI_ENABLED || '').trim().toLowerCase() === 'true';

  if (!configured) {
    return {
      enabled: false,
      reason: 'AI search is not enabled (set OPEN_COMPOUNDS_AI_ENABLED=true after approving a provider/model).',
      provider: providerId || null,
      model,
      apiKey: '',
      baseUrl: null,
      allowPaid,
    };
  }
  if (!provider) {
    return {
      enabled: false,
      reason: `AI provider must be one of: ${Object.keys(OPEN_COMPOUNDS_AI_PROVIDERS).join(', ')}.`,
      provider: providerId || null,
      model,
      apiKey: '',
      baseUrl: null,
      allowPaid,
    };
  }
  if (!model) {
    return {
      enabled: false,
      reason: 'OPEN_COMPOUNDS_AI_MODEL is required when AI is enabled.',
      provider: provider.id,
      model: null,
      apiKey: '',
      baseUrl: provider.baseUrl,
      allowPaid,
    };
  }
  if (!apiKey) {
    return {
      enabled: false,
      reason: 'No AI API key configured (OPEN_COMPOUNDS_AI_API_KEY or provider key). Deterministic “Search without AI” still works.',
      provider: provider.id,
      model,
      apiKey: '',
      baseUrl: provider.baseUrl,
      allowPaid,
    };
  }
  if (!allowPaid && !isLikelyFreeModel(model) && provider.id === 'openrouter') {
    return {
      enabled: false,
      reason: `Model "${model}" does not look free-tier. Use a :free model / openrouter/free, or set OPEN_COMPOUNDS_AI_ALLOW_PAID=true after budget approval.`,
      provider: provider.id,
      model,
      apiKey: '',
      baseUrl: provider.baseUrl,
      allowPaid,
    };
  }
  if (!allowPaid && provider.id === 'openai') {
    return {
      enabled: false,
      reason: 'OpenAI models require OPEN_COMPOUNDS_AI_ALLOW_PAID=true after budget approval.',
      provider: provider.id,
      model,
      apiKey: '',
      baseUrl: provider.baseUrl,
      allowPaid,
    };
  }

  return {
    enabled: true,
    reason: 'AI tool-calling search is available. Scores still come from RDKit, not the model.',
    provider: provider.id,
    model,
    apiKey,
    baseUrl: provider.baseUrl,
    allowPaid,
  };
}

export function openCompoundsAiToolDefinition() {
  return {
    type: 'function',
    function: {
      name: OPEN_COMPOUNDS_AI_TOOL_NAME,
      description:
        'Search public ChEMBL for compounds similar to the locked query SMILES, then re-score with RDKit Morgan radius 2 / 2048-bit Tanimoto (chirality off). Returns validated structures, ChEMBL IDs, source URLs, and calculated similarities. Do not invent scores or IDs.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          smiles: {
            type: 'string',
            description: 'Must equal the locked query SMILES supplied by the user controls.',
          },
          threshold: {
            type: 'number',
            description: `Minimum Morgan Tanimoto threshold (${OPEN_SIMILARITY_MIN_THRESHOLD}-${OPEN_SIMILARITY_MAX_THRESHOLD}). Must match the locked UI value.`,
          },
          maxResults: {
            type: 'integer',
            description: `Requested result count (1-${OPEN_SIMILARITY_MAX_RESULTS}). Must match the locked UI value.`,
          },
        },
        required: ['smiles', 'threshold', 'maxResults'],
      },
    },
  };
}

export function buildAiSystemPrompt(locked) {
  return [
    'You are the Open compounds assistant for Pyxis Discovery.',
    'You orchestrate a chemical similarity search. You do NOT compute similarity yourself.',
    'You MUST call the tool search_similar_open_compounds exactly once with the locked parameters.',
    `Locked query SMILES: ${locked.smiles}`,
    `Locked threshold: ${locked.threshold}`,
    `Locked maxResults: ${locked.maxResults}`,
    'Fingerprint: RDKit Morgan radius=2 nBits=2048 useChirality=false, Tanimoto.',
    'If the user instruction asks to change the molecule, threshold, or count, explain the conflict and still call the tool with the locked values (do not invent a different search).',
    'After the tool returns, write a short grounded summary referring only to tool results (IDs, SMILES, calculated scores). Never invent compounds, prices, affinity, or docking suitability.',
    'Never claim results are exhaustive database-wide top-N; they are ranked among retrieved ChEMBL candidates.',
  ].join('\n');
}

export function parseOpenCompoundsAiBody(body = {}) {
  const params = parseOpenCompoundsQuery({
    smiles: body.smiles,
    threshold: body.threshold,
    maxResults: body.maxResults,
    offset: 0,
    limit: body.maxResults ?? OPEN_SIMILARITY_MAX_RESULTS,
  });
  // AI returns the full ranked window; pagination is client-side over that set.
  params.offset = 0;
  params.limit = params.maxResults;

  let instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction.length > OPEN_COMPOUNDS_AI_INSTRUCTION_MAX) {
    throw new OpenCompoundsValidationError(
      `instruction is too long (max ${OPEN_COMPOUNDS_AI_INSTRUCTION_MAX} characters)`
    );
  }
  if (!instruction) instruction = null;

  return { params, instruction };
}

/**
 * Validate tool arguments against locked UI controls.
 * Returns { ok:true, args } or { ok:false, error } — never silently changes chemistry.
 */
export function validateToolArgumentsAgainstLock(locked, rawArgs) {
  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { ok: false, error: 'Tool arguments were not valid JSON.' };
    }
  }
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'Tool arguments must be an object.' };
  }

  const smiles = typeof args.smiles === 'string' ? args.smiles.trim() : '';
  const threshold = Number(args.threshold);
  const maxResults = Number(args.maxResults);

  if (!smiles) return { ok: false, error: 'Tool arguments missing smiles.' };
  if (smiles !== locked.smiles) {
    return {
      ok: false,
      error: `Tool smiles must match the locked query. Refusing to change the molecule (got a different SMILES).`,
    };
  }
  if (!Number.isFinite(threshold) || Math.abs(threshold - locked.threshold) > 1e-9) {
    return {
      ok: false,
      error: `Tool threshold must equal the locked value ${locked.threshold}.`,
    };
  }
  if (!Number.isInteger(maxResults) || maxResults !== locked.maxResults) {
    return {
      ok: false,
      error: `Tool maxResults must equal the locked value ${locked.maxResults}.`,
    };
  }
  return {
    ok: true,
    args: { smiles, threshold, maxResults },
  };
}

/** Strip secrets from provider error text. */
export function sanitizeProviderError(text) {
  return String(text || '')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 400);
}

/**
 * Call an OpenAI-compatible chat completions endpoint with tools.
 * `fetchImpl` must accept (url, { method, headers, body, signal, timeoutMs }).
 */
export async function callChatCompletions({
  runtime,
  messages,
  tools,
  toolChoice = 'auto',
  fetchImpl,
  signal,
  timeoutMs = OPEN_COMPOUNDS_AI_TIMEOUT_MS,
}) {
  const url = `${runtime.baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${runtime.apiKey}`,
    Accept: 'application/json',
  };
  // OpenRouter optionally wants these; harmless elsewhere.
  if (runtime.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://app.pyxis-discovery.com';
    headers['X-Title'] = 'Pyxis Discovery Open Compounds';
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: runtime.model,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: 0,
        max_tokens: OPEN_COMPOUNDS_AI_MAX_TOKENS,
      }),
      signal,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new OpenCompoundsAiError('AI request was cancelled or timed out.', {
        code: 'OPEN_COMPOUNDS_AI_TIMEOUT',
        status: 504,
      });
    }
    throw new OpenCompoundsAiError(
      `AI provider unreachable: ${sanitizeProviderError(error?.message || error)}`,
      { code: 'OPEN_COMPOUNDS_AI_UPSTREAM', status: 502 }
    );
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = sanitizeProviderError(
      payload?.error?.message || payload?.error || text || `HTTP ${response.status}`
    );
    const status = response.status === 429 ? 503 : (response.status === 401 || response.status === 403 ? 502 : 502);
    throw new OpenCompoundsAiError(`AI provider error: ${detail}`, {
      code: response.status === 429 ? 'OPEN_COMPOUNDS_AI_RATE_LIMIT' : 'OPEN_COMPOUNDS_AI_UPSTREAM',
      status,
    });
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (!message) {
    throw new OpenCompoundsAiError('AI provider returned no message.', {
      code: 'OPEN_COMPOUNDS_AI_UPSTREAM',
      status: 502,
    });
  }
  return {
    message,
    usage: payload?.usage || null,
    model: payload?.model || runtime.model,
  };
}

function pushStage(stages, onStage, stage, detail = '') {
  const entry = { stage, detail, at: new Date().toISOString() };
  stages.push(entry);
  if (typeof onStage === 'function') onStage(entry);
  return entry;
}

/**
 * Execute one validated tool call → deterministic open-compounds search.
 * Returns a JSON-serializable tool payload (no molblocks).
 */
export async function executeSearchTool({
  locked,
  rawArguments,
  config,
  fetchImpl,
  rdkitLoader,
}) {
  const checked = validateToolArgumentsAgainstLock(locked, rawArguments);
  if (!checked.ok) {
    return {
      ok: false,
      error: checked.error,
      code: 'OPEN_COMPOUNDS_AI_TOOL_ARGS',
    };
  }

  try {
    const payload = await runOpenCompoundsSearch({
      config,
      params: {
        smiles: locked.smiles,
        threshold: locked.threshold,
        offset: 0,
        limit: locked.maxResults,
        maxResults: locked.maxResults,
      },
      fetchImpl,
      rdkitLoader,
    });
    const { _molblocksById, ...publicPayload } = payload;
    return {
      ok: true,
      fingerprint: OPEN_COMPOUNDS_FINGERPRINT,
      rankingNote: publicPayload.retrieval?.rankingNote,
      total: publicPayload.total,
      results: publicPayload.results,
      stats: publicPayload.stats,
      query_smiles_canonical: publicPayload.query_smiles_canonical,
      // Keep molblocks only in the parent runner via a side channel
      _molblocksById,
      _fullPayload: publicPayload,
    };
  } catch (error) {
    if (error instanceof OpenCompoundsValidationError
        || error instanceof OpenCompoundsUnavailableError
        || error instanceof OpenCompoundsUpstreamError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      ok: false,
      error: sanitizeProviderError(error?.message || error),
      code: 'OPEN_COMPOUNDS_UPSTREAM',
    };
  }
}

/**
 * Full AI tool loop. Results are ALWAYS from the last successful tool execution.
 */
export async function runOpenCompoundsAiSearch({
  config,
  runtime,
  params,
  instruction = null,
  fetchImpl,
  chatCompletionsImpl = callChatCompletions,
  rdkitLoader,
  onStage,
  signal,
}) {
  if (!runtime?.enabled) {
    throw new OpenCompoundsAiError(runtime?.reason || 'AI search is not available.', {
      code: 'OPEN_COMPOUNDS_AI_UNAVAILABLE',
      status: 503,
    });
  }

  const locked = {
    smiles: params.smiles,
    threshold: params.threshold,
    maxResults: params.maxResults,
  };
  const stages = [];
  pushStage(stages, onStage, 'interpreting', 'Preparing the AI request with locked SMILES, threshold, and result count.');

  const tools = [openCompoundsAiToolDefinition()];
  const messages = [
    { role: 'system', content: buildAiSystemPrompt(locked) },
    {
      role: 'user',
      content: [
        'Run an open-compounds similarity search with the locked controls.',
        instruction ? `Additional instruction: ${instruction}` : 'No extra instruction.',
        'Call the search tool, then summarize the validated tool results briefly.',
      ].join('\n'),
    },
  ];

  let toolCallsUsed = 0;
  let lastSuccessfulTool = null;
  let finalAssistantText = '';
  let providerModel = runtime.model;

  for (let round = 0; round < OPEN_COMPOUNDS_AI_MAX_ROUNDS; round += 1) {
    pushStage(
      stages,
      onStage,
      round === 0 ? 'calling_model' : 'model_followup',
      round === 0 ? 'Waiting for the model to request the chemical-search tool.' : 'Sending tool results back to the model.'
    );

    const completion = await chatCompletionsImpl({
      runtime,
      messages,
      tools,
      toolChoice: toolCallsUsed === 0 ? 'required' : 'auto',
      fetchImpl,
      signal,
    });
    providerModel = completion.model || providerModel;
    const message = completion.message;
    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      finalAssistantText = typeof message.content === 'string' ? message.content.trim() : '';
      if (lastSuccessfulTool) break;
      throw new OpenCompoundsAiError(
        'The AI did not call the chemical-search tool. No results were invented. Try again or use “Search without AI”.',
        { code: 'OPEN_COMPOUNDS_AI_NO_TOOL', status: 502 }
      );
    }

    if (toolCallsUsed + toolCalls.length > OPEN_COMPOUNDS_AI_MAX_TOOL_CALLS) {
      throw new OpenCompoundsAiError(
        `AI exceeded the tool-call limit (${OPEN_COMPOUNDS_AI_MAX_TOOL_CALLS}).`,
        { code: 'OPEN_COMPOUNDS_AI_TOOL_LIMIT', status: 502 }
      );
    }

    for (const call of toolCalls) {
      const name = call?.function?.name || call?.name;
      const callId = call?.id || `call_${toolCallsUsed + 1}`;
      toolCallsUsed += 1;

      if (name !== OPEN_COMPOUNDS_AI_TOOL_NAME) {
        const errPayload = {
          ok: false,
          error: `Unknown tool "${name}". Only ${OPEN_COMPOUNDS_AI_TOOL_NAME} is allowed.`,
        };
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify(errPayload),
        });
        continue;
      }

      pushStage(stages, onStage, 'searching_sources', 'Searching ChEMBL and re-scoring with RDKit Morgan/Tanimoto.');
      const toolResult = await executeSearchTool({
        locked,
        rawArguments: call?.function?.arguments ?? call?.arguments,
        config,
        fetchImpl,
        rdkitLoader,
      });

      // Never send molblocks / internal maps to the model.
      const { _molblocksById, _fullPayload, ...safeForModel } = toolResult;
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify(safeForModel),
      });

      if (toolResult.ok) {
        lastSuccessfulTool = toolResult;
        pushStage(
          stages,
          onStage,
          'ranked',
          `Tool returned ${toolResult.total} ranked compound(s) with calculated Morgan Tanimoto scores.`
        );
      } else {
        pushStage(stages, onStage, 'tool_error', toolResult.error || 'Tool failed');
      }
    }
  }

  if (!lastSuccessfulTool) {
    throw new OpenCompoundsAiError(
      'AI ran but the chemical-search tool did not return validated results.',
      { code: 'OPEN_COMPOUNDS_AI_TOOL_FAILED', status: 502 }
    );
  }

  // One optional follow-up already happened inside the loop when tool_calls empty after success.
  // If the last message still has no text, ask once for a summary without more tools.
  if (!finalAssistantText) {
    pushStage(stages, onStage, 'summarizing', 'Asking the model for a short grounded summary of tool results.');
    try {
      const summary = await chatCompletionsImpl({
        runtime,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Reply with a concise summary of the tool results only. Do not call tools. Do not invent scores.',
          },
        ],
        tools,
        toolChoice: 'none',
        fetchImpl,
        signal,
      });
      finalAssistantText = typeof summary.message?.content === 'string'
        ? summary.message.content.trim()
        : '';
      providerModel = summary.model || providerModel;
    } catch {
      finalAssistantText = '';
    }
  }

  pushStage(stages, onStage, 'complete', 'AI workflow finished. Displayed scores are from RDKit.');

  const publicPayload = lastSuccessfulTool._fullPayload;
  return {
    ...publicPayload,
    mode: 'ai',
    ai: {
      provider: runtime.provider,
      model: providerModel,
      toolCalls: toolCallsUsed,
      stages,
      explanation: finalAssistantText || null,
      scoresFrom: 'rdkit_morgan_tanimoto',
      instructionHonored: Boolean(instruction),
    },
    _molblocksById: lastSuccessfulTool._molblocksById || {},
  };
}
