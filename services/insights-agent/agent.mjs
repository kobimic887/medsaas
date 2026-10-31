#!/usr/bin/env bun
// Pyxis Insights agent: finds one recent paper on PubMed, writes a short post
// grounded only in its abstract, checks it, and creates a WordPress Insights
// draft for a person to review and publish.
//
//   bun services/insights-agent/agent.mjs --dry-run   # print the post, touch nothing
//   bun services/insights-agent/agent.mjs             # create the WordPress post
//
// Configuration: environment variables, or KEY=value lines in the file named
// by INSIGHTS_AGENT_ENV (default ~/.config/pyxis-insights-agent/env, mode 0600).
// See README.md and deploy/env.example.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { complete, extractJson } from './lib/llm.mjs';
import { finalizeHtml, parseDraft, reviewDraft, selectionPrompt, slugify, writingPrompt } from './lib/post.mjs';
import { collectCandidates } from './lib/pubmed.mjs';
import { WordPress } from './lib/wordpress.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error(`${path} must not be readable by group/others (chmod 600)`);
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvFile(process.env.INSIGHTS_AGENT_ENV || join(homedir(), '.config/pyxis-insights-agent/env'));
const env = process.env;
const config = {
  wp: { url: env.WP_URL || 'https://www.pyxis-discovery.com', user: env.WP_USER, appPassword: env.WP_APP_PASSWORD },
  status: env.WP_STATUS || 'draft',
  tag: env.WP_TAG || 'insight',
  featuredMedia: env.WP_FEATURED_MEDIA || '',
  llm: {
    provider: env.LLM_PROVIDER || 'openai',
    baseUrl: env.LLM_BASE_URL || 'http://127.0.0.1:20128/v1',
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL || (env.LLM_PROVIDER === 'claude-cli' ? 'sonnet' : 'openrouter/openrouter/free'),
    claudeBin: env.CLAUDE_BIN,
  },
  days: Number(env.PUBMED_DAYS || 21),
  pubmedKey: env.NCBI_API_KEY,
  notifyCmd: env.NOTIFY_CMD || '',
  stateFile: env.STATE_FILE || join(homedir(), '.local/state/pyxis-insights-agent/state.json'),
  queries: JSON.parse(readFileSync(join(import.meta.dir, 'queries.json'), 'utf8')),
};
if (!['draft', 'pending', 'publish'].includes(config.status)) throw new Error('WP_STATUS must be draft, pending or publish');

const log = (message) => console.error(`[insights-agent] ${message}`);

function readState() {
  try {
    return JSON.parse(readFileSync(config.stateFile, 'utf8'));
  } catch {
    return { covered: [] };
  }
}

function writeState(state) {
  mkdirSync(dirname(config.stateFile), { recursive: true });
  writeFileSync(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function notify(title, message) {
  if (!config.notifyCmd || dryRun) return;
  const child = Bun.spawn([...config.notifyCmd.split(/\s+/), title, message], { stdout: 'ignore', stderr: 'ignore' });
  await child.exited;
}

async function main() {
  const wp = new WordPress(config.wp);
  const state = readState();
  const covered = new Set(state.covered.map((entry) => entry.pmid));

  log(`searching PubMed (${config.queries.length} queries, last ${config.days} days)`);
  const candidates = await collectCandidates(config.queries, { covered, days: config.days, apiKey: config.pubmedKey });
  if (!candidates.length) {
    log('no new candidate papers; nothing to do');
    return;
  }
  log(`${candidates.length} candidates`);

  const shortlist = candidates.slice(0, 30);
  const choice = extractJson(await complete(selectionPrompt(shortlist), config.llm));
  const article = shortlist.find((candidate) => candidate.pmid === String(choice.pmid)) ?? shortlist[0];
  log(`picked PMID ${article.pmid}: ${article.title}`);

  if (!dryRun && wp.auth && (await wp.alreadyCovered(article.pmid))) {
    log(`PMID ${article.pmid} already has an Insight; recording and stopping`);
    writeState({ covered: [...state.covered, { pmid: article.pmid, at: new Date().toISOString(), skipped: true }] });
    return;
  }

  const learnLinks = await wp.learnLinks();
  let draft;
  let problems = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    draft = parseDraft(await complete(writingPrompt(article, learnLinks, problems.join('\n')), config.llm));
    problems = reviewDraft(draft, article, learnLinks);
    if (!problems.length) break;
    log(`draft ${attempt} rejected: ${problems.join(' | ')}`);
  }
  if (problems.length) {
    await notify('Pyxis Insights agent', `No post today: the draft for PMID ${article.pmid} failed checks.`);
    throw new Error(`draft failed checks after 3 attempts: ${problems.join(' | ')}`);
  }

  const html = finalizeHtml(draft.html, article, { reviewed: config.status !== 'publish', siteUrl: config.wp.url });
  const slug = slugify(draft.title);
  if (dryRun) {
    console.log(`TITLE: ${draft.title}\nSLUG: ${slug}\nSTATUS: ${config.status} (dry run, not posted)\n\n${html}`);
    return;
  }

  const tagIds = [await wp.tagId(config.tag)];
  const post = await wp.createInsight({ title: draft.title, html, slug, status: config.status, tagIds, featuredMedia: config.featuredMedia });
  writeState({ covered: [...state.covered, { pmid: article.pmid, postId: post.id, at: new Date().toISOString() }] });
  log(`created ${config.status} Insight ${post.id}: ${post.editLink}`);
  await notify(
    config.status === 'publish' ? 'Pyxis Insight published' : 'Pyxis Insight draft ready',
    `${draft.title} — ${config.status === 'publish' ? post.link : post.editLink}`,
  );
}

main().catch((error) => {
  log(`failed: ${error.message}`);
  process.exit(1);
});
