// One chat call, two interchangeable backends:
//   LLM_PROVIDER=claude-cli  `claude -p` on this host (Claude subscription login)
//   LLM_PROVIDER=openai      any OpenAI-compatible /chat/completions endpoint:
//                            OmniRoute (http://127.0.0.1:20128/v1), OpenRouter
//                            (https://openrouter.ai/api/v1), Anthropic's
//                            OpenAI-compatible API, etc.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function complete({ system, user }, config, { fetchImpl = fetch, spawnImpl = Bun.spawn } = {}) {
  if (config.provider === 'openai') return completeOpenAI({ system, user }, config, fetchImpl);
  if (config.provider === 'claude-cli') return completeClaudeCli({ system, user }, config, spawnImpl);
  throw new Error(`Unknown LLM_PROVIDER "${config.provider}" (use claude-cli or openai)`);
}

async function completeOpenAI({ system, user }, config, fetchImpl) {
  if (!config.baseUrl || !config.model) throw new Error('LLM_BASE_URL and LLM_MODEL are required for LLM_PROVIDER=openai');
  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 300_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LLM request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  const content = JSON.parse(text)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM returned no content');
  return content;
}

async function completeClaudeCli({ system, user }, config, spawnImpl) {
  // An empty working directory keeps project CLAUDE.md files out of the
  // prompt. --bare is not used: it disables the subscription (OAuth) login.
  const cwd = mkdtempSync(join(tmpdir(), 'pyxis-insights-'));
  try {
    const args = [
      config.claudeBin || 'claude',
      '-p',
      '--output-format', 'json',
      '--tools', '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt', system,
    ];
    if (config.model) args.push('--model', config.model);
    const child = spawnImpl(args, { cwd, stdin: new Blob([user]), stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), config.timeoutMs ?? 600_000);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(`claude -p exited ${code}: ${(stderr || stdout).slice(0, 300)}`);
    const parsed = JSON.parse(stdout);
    if (parsed.is_error || typeof parsed.result !== 'string') throw new Error(`claude -p error: ${String(parsed.result).slice(0, 300)}`);
    return parsed.result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Extracts the first JSON object from a reply that may wrap it in prose or a code fence. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Reply contained no JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}
