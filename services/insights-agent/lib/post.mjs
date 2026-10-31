// Prompts, reply parsing and the publication guard for an Insights post.
// The guard is the safety net for unattended runs: a draft that fails it is
// never sent to WordPress.

export const PYXIS_CONTEXT = `Pyxis Discovery (Amsterdam, Matrix Innovation Center) is a drug discovery company specialising in macrocyclic chemistry.
It supplies in-stock and virtual libraries of macrocycles and small molecules, and a web platform (the "web-shop") for similarity, exact and substructure search, docking, OpenFold3 structure prediction and ordering compounds.
Its PAMPA permeability measurements on macrocycles are the largest consistent source in the open Membrane Permeability Database for Nonpeptidic Macrocycles.
The audience is medicinal chemists, computational chemists and biotech R&D leads.`;

const ALLOWED_TAGS = new Set(['p', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'blockquote', 'sub', 'sup']);
export const MIN_WORDS = 250;
export const MAX_WORDS = 900;

export function sourceUrl(article) {
  return article.doi ? `https://doi.org/${article.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;
}

export function pubmedUrl(article) {
  return `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;
}

export function selectionPrompt(candidates) {
  const list = candidates
    .map((article, index) => `[${index + 1}] PMID ${article.pmid} | ${article.journal} ${article.year}\nTitle: ${article.title}\nAbstract: ${article.abstract.slice(0, 500)}…`)
    .join('\n\n');
  return {
    system: `You are the editor of the Insights blog of Pyxis Discovery.\n${PYXIS_CONTEXT}`,
    user: `Pick the ONE paper below that would make the most useful, accurate short blog post for our audience. Prefer primary research or substantial reviews about macrocycles, permeability, virtual screening, docking, AI for drug discovery, covalent drugs, fragment-based design or structure prediction. Avoid clinical case reports and papers only loosely related to small-molecule or macrocycle discovery.

Reply with only a JSON object: {"pmid": "<PMID>", "angle": "<one sentence on what the post should explain>"}

${list}`,
  };
}

export function writingPrompt(article, learnLinks, feedback = '') {
  const links = learnLinks.length
    ? learnLinks.map((link) => `- ${link.title}: ${link.url}`).join('\n')
    : '(none available)';
  return {
    system: `You write posts for the Insights blog of Pyxis Discovery.\n${PYXIS_CONTEXT}

Rules you must follow:
- Use ONLY facts stated in the paper's title and abstract below. Do not add numbers, results, methods, author names, affiliations or claims that are not in it. If something is unclear, leave it out.
- Never claim Pyxis was involved in the paper.
- Every number you write must appear in the abstract exactly as given.
- 350–650 words. Plain, precise English for scientists; no hype words ("revolutionary", "game-changer").
- HTML only with these tags: <p>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a href>, <sub>, <sup>. No <h1>/<h2>, no images, no inline styles.
- Links: you may link the paper (${sourceUrl(article)}) and, where a concept is genuinely explained, at most three of the Pyxis Learning Center articles listed. No other links.
- Do not add a source or reference section; it is appended automatically.
- End with one short paragraph on why this matters for drug discovery teams; you may mention that Pyxis's libraries and web platform support this kind of work only if it fits naturally.`,
    user: `Paper (PMID ${article.pmid}):
Title: ${article.title}
Journal: ${article.journal} ${article.year}
Abstract:
${article.abstract}

Pyxis Learning Center articles you may link:
${links}
${feedback ? `\nYour previous draft was rejected for these reasons; fix all of them:\n${feedback}\n` : ''}
Reply in exactly this format and nothing else:
TITLE: <headline, at most 90 characters, no trailing period>
---
<post HTML>`,
  };
}

export function parseDraft(reply) {
  const text = reply.replace(/^```(?:html)?\s*|```\s*$/g, '').trim();
  const match = text.match(/^TITLE:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]+)$/);
  if (!match) throw new Error('Draft reply is not in "TITLE: … --- HTML" format');
  return { title: match[1].trim().replace(/\.$/, ''), html: match[2].trim() };
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Numeric tokens worth checking: two or more digits, decimals or percentages.
 * Numbers glued to letters (IC50, CYP3A4, G12C, Cys145) are names, not data.
 */
export function numbersIn(text) {
  const plain = text
    .replace(/<\/?(sub|sup)>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(\d)\s+%/g, '$1%');
  const tokens = plain.match(/(?<![A-Za-z\d.,])\d[\d,.]*\d%?(?![A-Za-z\d])|(?<![A-Za-z\d.,])\d%/g) ?? [];
  return tokens
    .map((token) => token.replace(/,(?=\d{3}\b)/g, '').replace(/[.,]$/, ''))
    .filter((token) => /\d{2,}|\.\d|%/.test(token));
}

/**
 * Returns a list of problems; an empty list means the draft may be posted.
 * Checks tags, links, length, and that every number appears in the source.
 */
export function reviewDraft(draft, article, learnLinks) {
  const problems = [];
  const { title, html } = draft;
  if (!title || title.length > 90) problems.push(`Title must be 1–90 characters (got ${title?.length ?? 0}).`);
  if (/<\s*(script|style|iframe|img|h1|h2|form|input)\b/i.test(html)) problems.push('Uses a forbidden tag.');
  for (const [, tag] of html.matchAll(/<\/?([a-z0-9]+)\b/gi)) {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) problems.push(`Tag <${tag}> is not allowed.`);
  }
  if (/\son\w+\s*=|style\s*=|javascript:/i.test(html)) problems.push('Contains inline script or style attributes.');

  const allowedLinks = new Set([sourceUrl(article), pubmedUrl(article), ...learnLinks.map((link) => link.url)]);
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    if (!allowedLinks.has(href)) problems.push(`Link not allowed: ${href}`);
  }
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    if (!/\bhref="[^"]+"/i.test(tag)) problems.push('Anchor without href.');
  }

  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS) problems.push(`Length must be ${MIN_WORDS}–${MAX_WORDS} words (got ${words}).`);

  const source = numbersIn(`${article.title} ${article.abstract} ${article.year}`);
  const known = new Set(source.flatMap((number) => [number, number.replace(/%$/, '')]));
  const invented = [...new Set(numbersIn(`${title} ${html}`))].filter(
    (number) => !known.has(number) && !known.has(number.replace(/%$/, '')),
  );
  if (invented.length) problems.push(`Numbers not found in the abstract: ${invented.join(', ')}. Remove them or quote the abstract exactly.`);
  if (/\bPyxis\b[^.]*\b(co-?authored|led|conducted|our (study|paper|team found))/i.test(html)) {
    problems.push('Implies Pyxis took part in the study.');
  }
  return problems;
}

/** Deterministic citation appended to every post, so references are never generated. */
export function citationHtml(article) {
  const authors = article.authors.length > 2 ? `${article.authors[0]} et al.` : article.authors.join(' and ');
  const parts = [authors, `“${article.title.replace(/\.$/, '')}”`, `<em>${escapeHtml(article.journal)}</em>`, article.year].filter(Boolean);
  return `<p class="pyxis-insight-source"><strong>Source:</strong> ${parts
    .map((part) => (part.startsWith('<em>') ? part : escapeHtml(part)))
    .join(', ')}. <a href="${sourceUrl(article)}" target="_blank" rel="noopener">${article.doi ? `doi:${escapeHtml(article.doi)}` : 'PubMed'}</a> (PMID <a href="${pubmedUrl(article)}" target="_blank" rel="noopener">${article.pmid}</a>).</p>`;
}

/** Makes links off the WordPress site open in a new tab, like the existing Insights posts. */
export function finalizeHtml(html, article, { reviewed = true, siteUrl = 'https://www.pyxis-discovery.com' } = {}) {
  const site = new URL(siteUrl).host;
  const body = html.replace(/<a\b([^>]*)\bhref="(https?:\/\/[^"]+)"([^>]*)>/gi, (whole, before, href, after) => {
    if (/target=/i.test(whole) || new URL(href).host === site) return whole;
    return `<a${before}href="${href}"${after} target="_blank" rel="noopener">`;
  });
  // Only claim a human review when a person publishes the draft.
  const note = reviewed
    ? "This summary was drafted with AI assistance from the paper's abstract and reviewed by the Pyxis Discovery team."
    : "This summary was drafted with AI assistance from the paper's abstract.";
  return `${body}\n${citationHtml(article)}\n<p><em>${note}</em></p>`;
}

export function slugify(title) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Cut long slugs at a word boundary.
  return slug.length <= 80 ? slug : slug.slice(0, 80).replace(/-[^-]*$/, '');
}
