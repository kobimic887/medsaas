// Insights agent contract (bun run test:insights-agent). No network: PubMed,
// the LLM and WordPress are replaced with fixtures.
import assert from 'node:assert/strict';
import { complete, extractJson } from './lib/llm.mjs';
import { citationHtml, finalizeHtml, numbersIn, parseDraft, reviewDraft, slugify, writingPrompt } from './lib/post.mjs';
import { decodeXml, parsePubmedXml } from './lib/pubmed.mjs';
import { WordPress } from './lib/wordpress.mjs';

const xml = `<?xml version="1.0"?><PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID Version="1">40000001</PMID><Article>
<Journal><JournalIssue><PubDate><Year>2026</Year><Month>Oct</Month></PubDate></JournalIssue><Title>Journal of Medicinal Chemistry</Title></Journal>
<ArticleTitle>Permeable macrocycles &amp; their <i>chameleonic</i> behaviour.</ArticleTitle>
<Abstract><AbstractText Label="BACKGROUND">Macrocycles bind flat surfaces.</AbstractText><AbstractText Label="RESULTS">We measured 1,234 compounds; 67 % were permeable at pH 7.4 with IC<sub>50</sub> below 10 µM.</AbstractText></Abstract>
<AuthorList><Author><LastName>Smith</LastName></Author><Author><LastName>Jones</LastName></Author><Author><LastName>Lee</LastName></Author></AuthorList>
<PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList>
</Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">40000001</ArticleId><ArticleId IdType="doi">10.1021/acs.jmedchem.6b00001</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">40000002</PMID><Article><ArticleTitle>No abstract here</ArticleTitle></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>`;

const [article, ...rest] = parsePubmedXml(xml);
assert.equal(rest.length, 0, 'articles without an abstract are dropped');
assert.equal(article.pmid, '40000001');
assert.equal(article.title, 'Permeable macrocycles & their chameleonic behaviour.');
assert.equal(article.doi, '10.1021/acs.jmedchem.6b00001');
assert.equal(article.year, '2026');
assert.deepEqual(article.authors, ['Smith', 'Jones', 'Lee']);
assert.match(article.abstract, /^BACKGROUND: Macrocycles bind flat surfaces\.\nRESULTS: We measured 1,234/);
assert.equal(decodeXml('a &#x3b1; &#946; &lt;b&gt;'), 'a α β <b>');

// Numbers: thousands separators, spaced percentages, names like IC50/G12C ignored.
assert.deepEqual(numbersIn('We measured 1,234 compounds; 67 % at pH 7.4, IC<sub>50</sub>, KRAS G12C, 3D'), ['1234', '67%', '7.4']);

const learnLinks = [{ title: 'What is a macrocycle?', url: 'https://www.pyxis-discovery.com/learning/macrocycles/what-is-a-macrocycle/' }];
const paragraph = '<p>Macrocycles are large rings that bind flat protein surfaces, and the authors studied how they cross membranes in a careful series of experiments.</p>';
const goodHtml = `<p>The team measured 1,234 compounds and found that 67% were permeable at pH 7.4. Read the <a href="https://doi.org/10.1021/acs.jmedchem.6b00001">paper</a> or our guide to <a href="${learnLinks[0].url}">macrocycles</a>.</p>\n<h3>Why it matters</h3>\n${paragraph.repeat(12)}`;
const good = { title: 'Most macrocycles in a new study were permeable', html: goodHtml };
assert.deepEqual(reviewDraft(good, article, learnLinks), []);

const invented = { ...good, html: goodHtml.replace('67%', '82%') };
assert.match(reviewDraft(invented, article, learnLinks).join(' '), /Numbers not found in the abstract: 82%/);
const badLink = { ...good, html: goodHtml.replace('https://doi.org/10.1021/acs.jmedchem.6b00001', 'https://example.com/fake') };
assert.match(reviewDraft(badLink, article, learnLinks).join(' '), /Link not allowed: https:\/\/example\.com\/fake/);
const badTag = { ...good, html: `${goodHtml}<img src="x"><h2>Big</h2>` };
assert.match(reviewDraft(badTag, article, learnLinks).join(' '), /forbidden tag/);
assert.match(reviewDraft({ ...good, html: '<p>Too short.</p>' }, article, learnLinks).join(' '), /Length must be/);
assert.match(reviewDraft({ ...good, html: `${goodHtml}<p style="color:red">x</p>` }, article, learnLinks).join(' '), /inline script or style/);
assert.match(reviewDraft({ ...good, title: 'x'.repeat(91) }, article, learnLinks).join(' '), /Title must be/);

// Citation is generated from PubMed fields and escaped, never written by the model.
const citation = citationHtml(article);
assert.match(citation, /Smith et al\., “Permeable macrocycles &amp; their chameleonic behaviour”, <em>Journal of Medicinal Chemistry<\/em>, 2026\./);
assert.match(citation, /href="https:\/\/doi\.org\/10\.1021\/acs\.jmedchem\.6b00001"/);
assert.match(citation, /href="https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/40000001\/"/);
const finalized = finalizeHtml(goodHtml, article);
assert.match(finalized, /href="https:\/\/doi\.org\/10\.1021\/acs\.jmedchem\.6b00001" target="_blank" rel="noopener">paper/);
assert.doesNotMatch(finalized, new RegExp(`${learnLinks[0].url}" target`), 'internal links stay in the same tab');
const staging = finalizeHtml('<p><a href="http://127.0.0.1:8791/learning/x/">x</a></p>', article, { siteUrl: 'http://127.0.0.1:8791' });
assert.doesNotMatch(staging, /127\.0\.0\.1:8791\/learning\/x\/" target/, 'same-site check follows WP_URL');
assert.match(finalized, /reviewed by the Pyxis Discovery team/);
assert.doesNotMatch(finalizeHtml(goodHtml, article, { reviewed: false }), /reviewed by/, 'auto-publish must not claim a human review');

assert.deepEqual(parseDraft('```html\nTITLE: A headline.\n---\n<p>Body</p>\n```'), { title: 'A headline', html: '<p>Body</p>' });
assert.throws(() => parseDraft('<p>no title</p>'), /format/);
assert.deepEqual(extractJson('Sure!\n```json\n{"pmid": "1", "angle": "x"}\n```'), { pmid: '1', angle: 'x' });
assert.equal(slugify('Macrocycles: Permeable, Oral & Ready?'), 'macrocycles-permeable-oral-ready');
assert.ok(slugify('word '.repeat(40)).length <= 80);
assert.match(writingPrompt(article, learnLinks, 'Numbers not found').user, /previous draft was rejected[\s\S]*Numbers not found/);

// OpenAI-compatible provider: request shape and auth header.
let seen;
const fakeFetch = async (url, init) => {
  seen = { url: String(url), init };
  return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }));
};
assert.equal(await complete({ system: 's', user: 'u' }, { provider: 'openai', baseUrl: 'http://127.0.0.1:20128/v1/', apiKey: 'k', model: 'm' }, { fetchImpl: fakeFetch }), 'hello');
assert.equal(seen.url, 'http://127.0.0.1:20128/v1/chat/completions');
assert.equal(seen.init.headers.Authorization, 'Bearer k');
assert.deepEqual(JSON.parse(seen.init.body).messages.map((message) => message.role), ['system', 'user']);

// claude-cli provider: tools, settings and MCP are off; result comes from JSON.
let argv;
const fakeSpawn = (args) => {
  argv = args;
  return {
    stdout: new Blob([JSON.stringify({ is_error: false, result: 'drafted' })]).stream(),
    stderr: new Blob(['']).stream(),
    exited: Promise.resolve(0),
    kill() {},
  };
};
assert.equal(await complete({ system: 'S', user: 'U' }, { provider: 'claude-cli', model: 'sonnet' }, { spawnImpl: fakeSpawn }), 'drafted');
for (const flag of ['-p', '--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
assert.ok(!argv.includes('--bare'), '--bare would disable the subscription login');

// WordPress: application-password auth and the Insights payload.
const calls = [];
const wpFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ id: 99, link: 'https://www.pyxis-discovery.com/insights/x/' }), { status: 201 });
};
const wp = new WordPress({ url: 'https://www.pyxis-discovery.com/', user: 'agent', appPassword: 'abcd efgh ijkl' }, { fetchImpl: wpFetch });
const created = await wp.createInsight({ title: 'T', html: '<p>x</p>', slug: 't', status: 'draft', tagIds: [10], featuredMedia: '5' });
assert.equal(created.editLink, 'https://www.pyxis-discovery.com/wp-admin/post.php?post=99&action=edit');
assert.equal(calls[0].url, 'https://www.pyxis-discovery.com/wp-json/wp/v2/pyxis_insights');
assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('agent:abcdefghijkl').toString('base64')}`);
assert.deepEqual(JSON.parse(calls[0].init.body), { title: 'T', content: '<p>x</p>', slug: 't', status: 'draft', 'pyxis-insights-tag': [10], featured_media: 5 });

console.log('✓ insights agent: PubMed parsing, publication guard, citation, providers, WordPress payload');
