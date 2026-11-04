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
import { ILLUSTRATION_ALT, ILLUSTRATION_CAPTION, macrocycleIllustration } from './lib/illustration.mjs';
import { complete, extractJson } from './lib/llm.mjs';
import { finalizeHtml, isMacrocycleArticle, parseDraft, reviewDraft, selectionPrompt, slugify, writingPrompt } from './lib/post.mjs';
import { collectCandidates, fetchArticles } from './lib/pubmed.mjs';
import { WordPress } from './lib/wordpress.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] || '';
}
const requestedPmid = option('--pmid');
const replaceId = option('--replace-draft');
if (args.has('--pmid') && !/^\d+$/.test(requestedPmid)) throw new Error('--pmid requires a PubMed ID');
if (args.has('--replace-draft') && (!/^[1-9]\d*$/.test(replaceId) || !requestedPmid)) throw new Error('--replace-draft requires a post ID and --pmid');

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

  log(requestedPmid ? `fetching requested PMID ${requestedPmid}` : `searching PubMed (${config.queries.length} queries, last ${config.days} days)`);
  const collected = requestedPmid
    ? await fetchArticles([requestedPmid], { apiKey: config.pubmedKey })
    : await collectCandidates(config.queries, { covered, days: config.days, apiKey: config.pubmedKey });
  const candidates = collected.filter(isMacrocycleArticle);
  if (requestedPmid && !candidates.length) throw new Error('Requested paper has no explicit macrocycle connection in its title or abstract');
  if (!candidates.length) {
    log('no new papers with explicit macrocycle relevance; nothing to do');
    return;
  }
  log(`${candidates.length} candidates`);

  const shortlist = candidates.slice(0, 30);
  const choice = requestedPmid ? { pmid: requestedPmid } : extractJson(await complete(selectionPrompt(shortlist), config.llm));
  if (choice.pmid === null) {
    log('no sufficiently relevant macrocycle story selected; nothing to do');
    return;
  }
  const article = shortlist.find((candidate) => candidate.pmid === String(choice.pmid));
  if (!article) throw new Error('Model selected a PMID outside the eligible shortlist');
  log(`picked PMID ${article.pmid}: ${article.title}`);

  const replacing = replaceId ? await wp.draftForRewrite(replaceId, article.pmid) : null;
  if (!replaceId && !dryRun && wp.auth && (await wp.alreadyCovered(article.pmid))) {
    log(`PMID ${article.pmid} already has an Insight; recording and stopping`);
    writeState({ covered: [...state.covered, { pmid: article.pmid, at: new Date().toISOString(), skipped: true }] });
    return;
  }

  const learnLinks = await wp.learnLinks();
  let draft;
  let problems = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const reply = await complete(writingPrompt(article, learnLinks, problems.join('\n')), config.llm);
    try {
      draft = parseDraft(reply);
      problems = reviewDraft(draft, article, learnLinks);
    } catch (error) {
      problems = [error.message];
    }
    if (!problems.length) break;
    log(`draft ${attempt} rejected: ${problems.join(' | ')}`);
  }
  if (problems.length) {
    await notify('Pyxis Insights agent', `No post today: the draft for PMID ${article.pmid} failed checks.`);
    throw new Error(`draft failed checks after 3 attempts: ${problems.join(' | ')}`);
  }

  const slug = slugify(draft.title);
  if (dryRun) {
    const html = finalizeHtml(draft.html, article, { siteUrl: config.wp.url });
    console.log(`TITLE: ${draft.title}\nSLUG: ${slug}\nSTATUS: ${config.status} (dry run, not posted)\n\n${html}`);
    console.log(`\nILLUSTRATION: ${ILLUSTRATION_CAPTION} (1200×630 PNG; uploaded only in a real run)`);
    return;
  }

  const tagIds = [await wp.tagId(config.tag)];
  const illustration = await wp.uploadIllustration({
    png: macrocycleIllustration(article.pmid),
    filename: `pyxis-macrocycle-${article.pmid}.png`,
    alt: ILLUSTRATION_ALT,
    caption: ILLUSTRATION_CAPTION,
  });
  const html = finalizeHtml(draft.html, article, { siteUrl: config.wp.url, illustration });
  const status = replacing ? replacing.status : config.status;
  const post = await wp.createInsight({ title: draft.title, html, slug, status, tagIds, featuredMedia: config.featuredMedia || illustration.id, replaceId });
  // Do not delete media on an ambiguous post-request failure: WordPress might
  // have committed the post before a connection was lost. It remains in Media.
  writeState({ covered: [...state.covered.filter((entry) => entry.pmid !== article.pmid), { pmid: article.pmid, postId: post.id, at: new Date().toISOString() }] });
  log(`${replaceId ? 'updated' : 'created'} ${status} Insight ${post.id}: ${post.editLink}`);
  await notify(
    status === 'publish' ? 'Pyxis Insight published' : 'Pyxis Insight draft ready',
    `${draft.title} — ${status === 'publish' ? post.link : post.editLink}`,
  );
}

main().catch((error) => {
  log(`failed: ${error.message}`);
  process.exit(1);
});
