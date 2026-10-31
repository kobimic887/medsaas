// Learning Center starter-content contract (bun run test:learning-center).
// Parses content/articles/*.html with the same front-matter rules as
// includes/content.php and checks every article will import and link cleanly.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, 'wordpress/pyxis-learning-center');
const contentDir = join(root, 'content');
const articlesDir = join(contentDir, 'articles');

// Mirrors pyxis_learn_parse_article() in includes/content.php.
export function parseArticle(raw) {
  const match = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  let list = null;
  for (const line of match[1].split('\n')) {
    const item = line.match(/^-\s+(.*)$/);
    if (list !== null && item) {
      meta[list].push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) {
      const value = kv[2].trim();
      if (value === '') {
        list = kv[1];
        meta[list] = [];
      } else {
        list = null;
        meta[kv[1]] = value;
      }
    }
  }
  return { meta, body: `${match[2].trim()}\n` };
}

const failures = [];
const fail = (message) => failures.push(message);

const topics = JSON.parse(readFileSync(join(contentDir, 'topics.json'), 'utf8'));
const topicSlugs = new Set(topics.map((topic) => topic.slug));
for (const topic of topics) {
  if (!/^[a-z0-9-]+$/.test(topic.slug)) fail(`topic slug ${topic.slug} is not URL-safe`);
  if (topic.slug === 'glossary') fail('"glossary" is a reserved Learning Center URL');
  if (!topic.name || !topic.description) fail(`topic ${topic.slug} needs a name and description`);
}

const files = readdirSync(articlesDir).filter((name) => name.endsWith('.html'));
const slugs = new Set(files.map((name) => name.slice(0, -'.html'.length)));
const allowedTags = new Set([
  'p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'code', 'sub', 'sup',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'blockquote', 'br',
]);
const perTopic = new Map();
const titles = new Set();

for (const file of files) {
  const slug = file.slice(0, -'.html'.length);
  const parsed = parseArticle(readFileSync(join(articlesDir, file), 'utf8'));
  if (!parsed) {
    fail(`${file}: missing front matter`);
    continue;
  }
  const { meta, body } = parsed;
  if (!/^[a-z0-9-]+$/.test(slug)) fail(`${file}: slug is not URL-safe`);
  for (const key of ['title', 'topic', 'order', 'term', 'summary']) {
    if (typeof meta[key] !== 'string' || !meta[key]) fail(`${file}: front matter needs "${key}"`);
  }
  if (!topicSlugs.has(meta.topic)) fail(`${file}: unknown topic "${meta.topic}"`);
  if (titles.has(meta.title)) fail(`${file}: duplicate title`);
  titles.add(meta.title);
  if (!Array.isArray(meta.objectives) || meta.objectives.length < 2) fail(`${file}: needs at least two objectives`);
  if (meta.summary && meta.summary.length > 220) fail(`${file}: summary is ${meta.summary.length} chars (max 220)`);
  if (!/^\d+$/.test(meta.order ?? '')) fail(`${file}: order must be an integer`);
  const orderKey = `${meta.topic}:${meta.order}`;
  if (perTopic.has(orderKey)) fail(`${file}: order ${meta.order} repeats ${perTopic.get(orderKey)}`);
  perTopic.set(orderKey, file);

  // The template prints the <h1>; bodies start at <h2>.
  for (const [, tag] of body.matchAll(/<\/?([a-z0-9]+)\b/gi)) {
    if (!allowedTags.has(tag.toLowerCase())) fail(`${file}: disallowed <${tag}>`);
  }
  if (/\son\w+=|style=|javascript:/i.test(body)) fail(`${file}: inline script or style attribute`);
  const opens = body.match(/\[pyxis_learn_link\b/g)?.length ?? 0;
  const closes = body.match(/\[\/pyxis_learn_link\]/g)?.length ?? 0;
  if (opens !== closes) fail(`${file}: unbalanced [pyxis_learn_link] shortcodes`);
  for (const [, target] of body.matchAll(/\[pyxis_learn_link slug="([^"]+)"\]/g)) {
    if (!slugs.has(target)) fail(`${file}: links to missing article "${target}"`);
    if (target === slug) fail(`${file}: links to itself`);
  }
  const words = body.replace(/<[^>]+>|\[[^\]]+\]/g, ' ').split(/\s+/).filter(Boolean).length;
  if (words < 200) fail(`${file}: only ${words} words`);
}

for (const topic of topics) {
  if (![...perTopic.keys()].some((key) => key.startsWith(`${topic.slug}:`))) fail(`topic ${topic.slug} has no articles`);
}

// The same parser must round-trip a list and a value containing a colon.
const sample = parseArticle('---\ntitle: A: B\nobjectives:\n- one\n- two\nterm: T\n---\n<p>x</p>');
if (sample?.meta.title !== 'A: B' || sample.meta.objectives.join('|') !== 'one|two' || sample.meta.term !== 'T') {
  fail('front-matter parser self-test failed');
}

if (failures.length) {
  console.error(failures.map((line) => `✗ ${line}`).join('\n'));
  process.exit(1);
}
console.log(`✓ learning center: ${topics.length} topics, ${files.length} articles, internal links resolve`);
