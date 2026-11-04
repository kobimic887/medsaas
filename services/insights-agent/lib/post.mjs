// Prompts, reply parsing and the publication guard for an Insights post.
// The guard is the safety net for unattended runs: a draft that fails it is
// never sent to WordPress.

export const PYXIS_CONTEXT = `Pyxis Discovery (Amsterdam, Matrix Innovation Center) is a drug discovery company specialising in macrocyclic chemistry.
It supplies in-stock and virtual libraries of macrocycles and small molecules, and a web platform (the "web-shop") for similarity, exact and substructure search, docking, OpenFold3 structure prediction and ordering compounds.
Its PAMPA permeability measurements on macrocycles are the largest consistent source in the open Membrane Permeability Database for Nonpeptidic Macrocycles.
The audience is medicinal chemists, computational chemists and biotech R&D leads.`;

const ALLOWED_TAGS = new Set(['p', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'blockquote', 'sub', 'sup']);
export const MIN_WORDS = 150;
export const MAX_WORDS = 250;

export function sourceUrl(article) {
  return article.doi ? `https://doi.org/${article.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;
}

export function pubmedUrl(article) {
  return `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;
}

/** Evidence gate: broad biochemistry, docking or bRo5 alone is not macrocycle news. */
export function isMacrocycleArticle(article) {
  return /\bmacrocycl(?:e[sd]?|ic|ization|isation)\b/i.test(`${article.title} ${article.abstract}`);
}

export function selectionPrompt(candidates) {
  const list = candidates
    .map((article, index) => `[${index + 1}] PMID ${article.pmid} | ${article.journal} ${article.year}\nTitle: ${article.title}\nAbstract: ${article.abstract}`)
    .join('\n\n');
  return {
    system: `You are the editor of the Insights blog of Pyxis Discovery.\n${PYXIS_CONTEXT}`,
    user: `Pick the ONE paper below that would make the most useful, accurate short blog post for our audience. Choose primary research or a substantial review with a direct, evidenced connection to macrocyclic molecules. General biochemistry, therapeutic pathways, docking or AI alone are insufficient. Never invent a macrocycle angle. Return {"pmid": null} if none qualifies.

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
- 150–250 words in three short paragraphs. The very first sentence MUST begin with the exact words "For macrocycle discovery," and immediately state the source-evidenced relevance. Then explain the finding and one practical implication or limitation. Avoid generic biochemical background and sales claims. Plain, precise English for scientists; no hype words ("revolutionary", "game-changer").
- HTML only with these tags: <p>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a href>, <sub>, <sup>. No <h1>/<h2>, no images, no inline styles.
- Links: you may link the paper (${sourceUrl(article)}) and, where a concept is genuinely explained, at most three of the Pyxis Learning Center articles listed. No other links.
- Do not add a source or reference section, DOI text, PMID text, journal/year line or bibliography; the citation is appended automatically.
- At most one short heading and one Learning Center link. No promotional closing paragraph. Distinguish predictions or hypotheses from experimental results. An original conceptual macrocycle illustration is added separately; do not describe it as study data.`,
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
  if (!isMacrocycleArticle(article)) problems.push('Source has no explicit macrocycle connection; choose another paper.');
  const opening = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || '';
  const firstSentence = opening.trim().split(/(?<=[.!?])\s+/)[0];
  if (!/\bmacrocycl(?:e[sd]?|ic|ization|isation)\b/i.test(firstSentence)) problems.push('First paragraph must start by explaining the source-evidenced macrocycle relevance.');
  if (!title || title.length > 90) problems.push(`Title must be 1–90 characters (got ${title?.length ?? 0}).`);
  if (/<\s*(script|style|iframe|img|h1|h2|form|input)\b/i.test(html)) problems.push('Uses a forbidden tag.');
  for (const [, tag] of html.matchAll(/<\/?([a-z0-9]+)\b/gi)) {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) problems.push(`Tag <${tag}> is not allowed.`);
  }
  // A truncated completion can end mid-paragraph while still meeting the word
  // count. Refuse incomplete or misnested markup rather than trusting WP repair.
  const stack = [];
  for (const [, closing, tag] of html.matchAll(/<(\/?)([a-z0-9]+)\b[^>]*>/gi)) {
    if (closing) {
      if (stack.pop() !== tag.toLowerCase()) problems.push('HTML tags are misnested or incomplete.');
    } else stack.push(tag.toLowerCase());
  }
  if (stack.length || /<[^>]*$/.test(html)) problems.push('HTML tags are misnested or incomplete.');
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
  // An exact source DOI is an identifier, not a numerical scientific claim.
  // Strip only that full identifier: its numeric prefix alone is still checked.
  const draftText = `${title} ${html}`;
  const numericText = article.doi ? draftText.split(article.doi).join('') : draftText;
  const invented = [...new Set(numbersIn(numericText))].filter(
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
export function finalizeHtml(html, article, { siteUrl = 'https://www.pyxis-discovery.com', illustration } = {}) {
  const site = new URL(siteUrl).host;
  const body = html.replace(/<a\b([^>]*)\bhref="(https?:\/\/[^"]+)"([^>]*)>/gi, (whole, before, href, after) => {
    if (/target=/i.test(whole) || new URL(href).host === site) return whole;
    return `<a${before}href="${href}"${after} target="_blank" rel="noopener">`;
  });
  // A generated draft has not been reviewed, even when its later publication is manual.
  const note = "This summary was drafted with AI assistance from the paper's abstract. Editorial review is required before publication.";
  let figure = '';
  if (illustration) {
    const imageUrl = new URL(illustration.url);
    if (!['https:', 'http:'].includes(imageUrl.protocol) || imageUrl.host !== site) throw new Error('Illustration must be a WordPress-hosted image');
    figure = `<figure><img src="${escapeHtml(imageUrl.href)}" alt="${escapeHtml(illustration.alt)}" width="1200" height="630" /><figcaption>${escapeHtml(illustration.caption)}</figcaption></figure>\n`;
  }
  return `${figure}${body}\n${citationHtml(article)}\n<p><em>${note}</em></p>`;
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
