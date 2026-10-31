// PubMed E-utilities: recent papers for the configured queries, with abstracts.
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/ — without an API key NCBI
// allows 3 requests/second, so calls are spaced.
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TOOL = 'pyxis-insights-agent';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eutils(path, params, { fetchImpl = fetch, apiKey } = {}) {
  const url = new URL(`${EUTILS}/${path}`);
  for (const [key, value] of Object.entries({ ...params, tool: TOOL, ...(apiKey ? { api_key: apiKey } : {}) })) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url, { headers: { 'User-Agent': TOOL } });
  if (!response.ok) throw new Error(`PubMed ${path} failed: HTTP ${response.status}`);
  return response;
}

/** PMIDs published in the last `days` days that match `query`, newest first. */
export async function searchPubmed(query, { days = 21, max = 15, ...options } = {}) {
  const response = await eutils(
    'esearch.fcgi',
    { db: 'pubmed', term: `(${query}) AND hasabstract`, datetype: 'pdat', reldate: days, retmax: max, sort: 'pub_date', retmode: 'json' },
    options,
  );
  const body = await response.json();
  return body?.esearchresult?.idlist ?? [];
}

export async function fetchArticles(pmids, options = {}) {
  if (!pmids.length) return [];
  const response = await eutils('efetch.fcgi', { db: 'pubmed', id: pmids.join(','), retmode: 'xml' }, options);
  return parsePubmedXml(await response.text());
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const first = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : '';
};

/** Parses an efetch PubmedArticleSet into plain objects. */
export function parsePubmedXml(xml) {
  const articles = [];
  for (const [, block] of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)) {
    const pmid = first(block, 'PMID');
    const title = first(block, 'ArticleTitle');
    // Structured abstracts have several labelled sections.
    const abstract = [...block.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map(([, attrs, text]) => {
        const label = attrs.match(/Label="([^"]+)"/)?.[1];
        const body = decodeXml(text);
        return label ? `${decodeXml(label)}: ${body}` : body;
      })
      .filter(Boolean)
      .join('\n');
    const doi = block.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1]?.trim() ?? '';
    const journal = first(block, 'Title') || first(block, 'ISOAbbreviation');
    const year = first(block.match(/<PubDate>[\s\S]*?<\/PubDate>/)?.[0] ?? '', 'Year') || first(block, 'MedlineDate').slice(0, 4);
    const authors = [...block.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)]
      .map(([, author]) => first(author, 'LastName') || first(author, 'CollectiveName'))
      .filter(Boolean);
    const types = [...block.matchAll(/<PublicationType\b[^>]*>([^<]+)<\/PublicationType>/g)].map(([, type]) => type);
    if (!pmid || !title || !abstract) continue;
    articles.push({ pmid, title, abstract, doi, journal, year, authors, types });
  }
  return articles;
}

/** Collects candidates across queries, deduplicated, skipping already covered PMIDs. */
export async function collectCandidates(queries, { covered = new Set(), days, perQuery = 8, minAbstract = 600, ...options } = {}) {
  const seen = new Set();
  const ids = [];
  for (const query of queries) {
    for (const pmid of await searchPubmed(query, { days, max: perQuery, ...options })) {
      if (!seen.has(pmid) && !covered.has(pmid)) {
        seen.add(pmid);
        ids.push(pmid);
      }
    }
    await sleep(400);
  }
  const articles = [];
  for (let index = 0; index < ids.length; index += 50) {
    articles.push(...(await fetchArticles(ids.slice(index, index + 50), options)));
    await sleep(400);
  }
  // Errata, retraction notices and comments are not news for the blog.
  const skipTypes = /erratum|retraction|comment|editorial|published erratum/i;
  return articles.filter((article) => article.abstract.length >= minAbstract && !article.types.some((type) => skipTypes.test(type)));
}
