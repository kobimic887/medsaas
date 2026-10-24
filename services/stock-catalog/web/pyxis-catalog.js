// Public Pyxis stock catalog widget.
//
// A static page: it reads pre-sorted chunks written by ../build_catalog.py and
// structure SVGs filed by scripts/render-structure-images.py, both from a CDN.
// It never calls the application API, so it needs no session and cannot log
// anyone out or spend credits. Ordering happens in the web-shop (the app).
//
// Embed (WordPress "Custom HTML" block or any page):
//   <div data-pyxis-catalog></div>
//   <script type="module" src="https://<cdn>/pyxis-catalog.js"></script>
// Optional attributes: data-data-base, data-image-base, data-shop-url,
// data-page-size. Defaults resolve next to this script: ./data/ and ./svg/.

export const DEFAULT_PAGE_SIZE = 25;
export const SORTS = Object.freeze([
  { key: 'id', label: 'By ID', defaultOrder: 'desc' },
  { key: 'library', label: 'By library', defaultOrder: 'asc' },
  { key: 'mw', label: 'By MW', defaultOrder: 'asc' },
  { key: 'availability', label: 'By availability', defaultOrder: 'desc' },
]);
const SORT_KEYS = SORTS.map((sort) => sort.key);
const DEFAULT_SHOP_URL = 'https://app.pyxis-discovery.com/dashboard/simulation';
const RDKIT_SRC = 'https://cdn.jsdelivr.net/npm/@rdkit/rdkit@2026.9.1/dist/RDKit_minimal.js';
const HASH_PREFIX = 'pxc-';
const MAX_CACHED_CHUNKS = 24;

// ── Pure helpers (exercised by test.mjs) ──────────────────────────────────────

export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Ascending row indices shown on a zero-based page. Chunks are stored ascending,
// so a descending page reads from the end of the same files.
export function pageIndices(total, page, pageSize, order) {
  const first = page * pageSize;
  const last = Math.min(total, first + pageSize);
  const indices = [];
  for (let position = first; position < last; position += 1) {
    indices.push(order === 'desc' ? total - 1 - position : position);
  }
  return indices;
}

export function chunksFor(indices, chunkSize) {
  return [...new Set(indices.map((index) => Math.floor(index / chunkSize)))];
}

export function imagePath(sha) {
  return `${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.svg`;
}

export function formatMass(mg) {
  if (!(mg > 0)) return 'On request';
  if (mg > 100) return '>100 mg';
  if (mg >= 10) return `${Math.round(mg)} mg`;
  if (mg < 0.1) return '<0.1 mg';
  return `${mg.toFixed(1)} mg`;
}

// "C12H14NO4-" → [["C","12"],["H","14"],["N",""],["O","4"]] + charge "-".
export function formulaParts(formula) {
  const match = /^(.*?)([+-]\d*)?$/.exec(formula);
  const body = match[1];
  const charge = match[2] || '';
  const atoms = [...body.matchAll(/([A-Z][a-z]?)(\d*)/g)].map((part) => [part[1], part[2]]);
  return { atoms, charge };
}

export function readState(hash, manifestTotal, pageSize) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const sort = SORT_KEYS.includes(params.get(`${HASH_PREFIX}sort`)) ? params.get(`${HASH_PREFIX}sort`) : 'id';
  const fallbackOrder = SORTS.find((entry) => entry.key === sort).defaultOrder;
  const orderParam = params.get(`${HASH_PREFIX}order`);
  const order = orderParam === 'asc' || orderParam === 'desc' ? orderParam : fallbackOrder;
  const pages = pageCount(manifestTotal, pageSize);
  const requested = Number.parseInt(params.get(`${HASH_PREFIX}page`) || '1', 10);
  const page = Number.isFinite(requested) ? Math.min(pages, Math.max(1, requested)) - 1 : 0;
  return { sort, order, page };
}

export function writeState(hash, state) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  params.set(`${HASH_PREFIX}sort`, state.sort);
  params.set(`${HASH_PREFIX}order`, state.order);
  params.set(`${HASH_PREFIX}page`, String(state.page + 1));
  return `#${params.toString()}`;
}

// ── Browser-only pieces ───────────────────────────────────────────────────────

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

let rdkitPromise = null;
// Only for structures whose pre-rendered image is missing: the browser draws the
// exact SMILES instead of showing a picture filed under another spelling.
function loadRdkit() {
  if (!rdkitPromise) {
    rdkitPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = RDKIT_SRC;
      script.onload = () => window.initRDKitModule({ locateFile: () => RDKIT_SRC.replace(/\.js$/, '.wasm') }).then(resolve, reject);
      script.onerror = reject;
      document.head.appendChild(script);
    }).catch((error) => {
      rdkitPromise = null;
      throw error;
    });
  }
  return rdkitPromise;
}

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'text') node.textContent = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function formulaNode(formula) {
  const { atoms, charge } = formulaParts(formula);
  const span = el('span', { class: 'pxc-formula' });
  for (const [symbol, count] of atoms) {
    span.append(symbol);
    if (count) span.append(el('sub', { text: count }));
  }
  if (charge) span.append(el('sup', { text: charge.length > 1 ? `${charge.slice(1)}${charge[0]}` : charge }));
  return span;
}

const numberFormat = new Intl.NumberFormat('en-US');

class Catalog {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.chunks = new Map();
    this.renderToken = 0;
    this.root.classList.add('pxc');
    this.root.innerHTML = '';
    this.status = el('p', { class: 'pxc-status', role: 'status', 'aria-live': 'polite' });
    this.tabs = el('div', { class: 'pxc-tabs', role: 'tablist', 'aria-label': 'Sort compounds' });
    this.topPager = el('nav', { class: 'pxc-pager', 'aria-label': 'Catalog pages' });
    this.grid = el('div', { class: 'pxc-grid' });
    this.bottomPager = el('nav', { class: 'pxc-pager', 'aria-label': 'Catalog pages (bottom)' });
    this.root.append(
      el('div', { class: 'pxc-toolbar' }, [this.status, this.topPager]),
      this.tabs,
      this.grid,
      el('div', { class: 'pxc-toolbar pxc-toolbar-bottom' }, [this.bottomPager]),
    );
    window.addEventListener('hashchange', () => this.syncFromHash());
  }

  async start() {
    this.renderSkeleton();
    try {
      const response = await fetch(new URL('manifest.json', this.config.dataBase));
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      this.manifest = await response.json();
    } catch (error) {
      this.renderError('The catalog could not be loaded.', () => this.start());
      return;
    }
    this.syncFromHash();
  }

  syncFromHash() {
    if (!this.manifest) return;
    this.state = readState(window.location.hash, this.manifest.total, this.config.pageSize);
    this.render();
  }

  go(next, { scroll = true } = {}) {
    const state = { ...this.state, ...next };
    const hash = writeState(window.location.hash, state);
    if (hash !== window.location.hash) history.pushState(null, '', hash);
    this.state = state;
    this.render();
    if (scroll && this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  chunk(sort, index) {
    const key = `${sort}/${index}`;
    if (!this.chunks.has(key)) {
      const request = fetch(new URL(`sorts/${key}.json`, this.config.dataBase)).then((response) => {
        if (!response.ok) throw new Error(`chunk ${key} ${response.status}`);
        return response.json();
      });
      request.catch(() => this.chunks.delete(key));
      this.chunks.set(key, request);
      if (this.chunks.size > MAX_CACHED_CHUNKS) this.chunks.delete(this.chunks.keys().next().value);
    }
    return this.chunks.get(key);
  }

  async render() {
    const token = ++this.renderToken;
    const { total, chunkSize } = this.manifest;
    const { sort, order, page } = this.state;
    const pageSize = this.config.pageSize;
    const indices = pageIndices(total, page, pageSize, order);
    // Tabs and pagers are rebuilt each render; keep keyboard focus on the same control.
    const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    this.renderTabs();
    this.renderPagers();
    if (focusKey) this.root.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
    const first = page * pageSize + 1;
    const last = page * pageSize + indices.length;
    this.status.textContent = `${numberFormat.format(first)}–${numberFormat.format(last)} of ${numberFormat.format(total)} compounds`;
    this.grid.setAttribute('aria-busy', 'true');
    let rows;
    try {
      const loaded = new Map();
      await Promise.all(chunksFor(indices, chunkSize).map(async (chunkIndex) => {
        loaded.set(chunkIndex, await this.chunk(sort, chunkIndex));
      }));
      rows = indices.map((index) => loaded.get(Math.floor(index / chunkSize))[index % chunkSize]);
    } catch (error) {
      if (token === this.renderToken) this.renderError('This page of the catalog could not be loaded.', () => this.render());
      return;
    }
    if (token !== this.renderToken) return;
    this.grid.replaceChildren(...rows.map((row) => this.card(row)));
    this.grid.removeAttribute('aria-busy');
  }

  renderTabs() {
    this.tabs.replaceChildren(...SORTS.map((sort) => {
      const active = sort.key === this.state.sort;
      const arrow = active ? (this.state.order === 'asc' ? ' ↑' : ' ↓') : '';
      return el('button', {
        type: 'button',
        role: 'tab',
        class: `pxc-tab${active ? ' is-active' : ''}`,
        'aria-selected': active ? 'true' : 'false',
        'data-focus-key': `tab-${sort.key}`,
        title: active ? 'Reverse order' : undefined,
        onclick: () => this.go({
          sort: sort.key,
          order: active ? (this.state.order === 'asc' ? 'desc' : 'asc') : sort.defaultOrder,
          page: 0,
        }),
      }, [sort.label, el('span', { class: 'pxc-arrow', 'aria-hidden': 'true', text: arrow })]);
    }));
  }

  renderPagers() {
    const pages = pageCount(this.manifest.total, this.config.pageSize);
    const { page } = this.state;
    for (const [pagerIndex, pager] of [this.topPager, this.bottomPager].entries()) {
      const input = el('input', {
        type: 'number', min: '1', max: String(pages), value: String(page + 1),
        class: 'pxc-page-input', 'aria-label': 'Page number', inputmode: 'numeric',
        'data-focus-key': `page-${pagerIndex}`,
      });
      const jump = () => {
        const value = Number.parseInt(input.value, 10);
        if (Number.isFinite(value)) this.go({ page: Math.min(pages, Math.max(1, value)) - 1 });
        else input.value = String(page + 1);
      };
      input.addEventListener('change', jump);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') jump(); });
      const button = (label, symbol, target, disabled) => el('button', {
        type: 'button', class: 'pxc-page-button', 'aria-label': label, title: label, disabled,
        'data-focus-key': `${label}-${pagerIndex}`.replace(/\W+/g, '-'),
        onclick: () => this.go({ page: target }),
      }, symbol);
      pager.replaceChildren(
        button('First page', '«', 0, page === 0),
        button('Previous page', '‹', page - 1, page === 0),
        el('span', { class: 'pxc-page-label' }, ['Page ', input, ` of ${numberFormat.format(pages)}`]),
        button('Next page', '›', page + 1, page >= pages - 1),
        button('Last page', '»', pages - 1, page >= pages - 1),
      );
    }
  }

  card([code, smiles, mw, formula, mg]) {
    const structure = el('div', { class: 'pxc-structure' });
    this.fillStructure(structure, code, smiles);
    const copy = el('button', {
      type: 'button', class: 'pxc-action', title: 'Copy SMILES',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(smiles);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
        setTimeout(() => { copy.textContent = 'Copy SMILES'; }, 1500);
      },
    }, 'Copy SMILES');
    return el('article', { class: 'pxc-card' }, [
      el('h3', { class: 'pxc-code', text: code }),
      structure,
      el('dl', { class: 'pxc-props' }, [
        el('div', {}, [el('dt', { text: 'MW' }), el('dd', { text: mw.toFixed(2) })]),
        el('div', {}, [el('dt', { text: 'Formula' }), el('dd', {}, formulaNode(formula))]),
        el('div', {}, [el('dt', { text: 'Available' }), el('dd', { text: formatMass(mg) })]),
      ]),
      el('details', { class: 'pxc-details' }, [
        el('summary', { text: 'SMILES' }),
        el('code', { class: 'pxc-smiles', text: smiles }),
      ]),
      el('div', { class: 'pxc-actions' }, [
        copy,
        el('a', {
          class: 'pxc-action pxc-order', href: this.config.shopUrl, target: '_blank', rel: 'noopener',
          title: `Order ${code} in the Pyxis web-shop`,
        }, 'Order'),
      ]),
    ]);
  }

  async fillStructure(container, code, smiles) {
    const fallback = async () => {
      try {
        const RDKit = await loadRdkit();
        const mol = RDKit.get_mol(smiles);
        if (!mol) throw new Error('invalid SMILES');
        try {
          container.innerHTML = mol.get_svg(300, 150);
        } finally {
          mol.delete();
        }
      } catch {
        container.replaceChildren(el('span', { class: 'pxc-structure-missing', text: 'Structure preview unavailable' }));
      }
    };
    if (!globalThis.crypto?.subtle) return fallback();
    const sha = await sha256Hex(smiles);
    container.replaceChildren(el('img', {
      src: new URL(imagePath(sha), this.config.imageBase).href,
      alt: `Structure of ${code}`, width: '300', height: '150', loading: 'lazy', decoding: 'async',
      onerror: fallback,
    }));
  }

  renderSkeleton() {
    this.grid.replaceChildren(...Array.from({ length: this.config.pageSize }, () => el('div', { class: 'pxc-card pxc-skeleton', 'aria-hidden': 'true' })));
  }

  renderError(message, retry) {
    this.grid.removeAttribute('aria-busy');
    this.grid.replaceChildren(el('div', { class: 'pxc-error', role: 'alert' }, [
      el('p', { text: message }),
      el('button', { type: 'button', class: 'pxc-action', onclick: retry }, 'Try again'),
    ]));
  }
}

function configFor(root) {
  const here = new URL('.', import.meta.url);
  const dir = (value, fallback) => new URL(value ? value.replace(/\/?$/, '/') : fallback, here);
  const pageSize = Number.parseInt(root.dataset.pageSize || '', 10);
  return {
    dataBase: dir(root.dataset.dataBase, 'data/'),
    imageBase: dir(root.dataset.imageBase, 'svg/'),
    shopUrl: root.dataset.shopUrl || DEFAULT_SHOP_URL,
    pageSize: pageSize > 0 && pageSize <= 100 ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

function ensureStylesheet() {
  const href = new URL('pyxis-catalog.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href)) return;
  document.head.append(el('link', { rel: 'stylesheet', href }));
}

if (typeof document !== 'undefined') {
  ensureStylesheet();
  // One catalog per page: the hash state is shared.
  const root = document.querySelector('[data-pyxis-catalog]');
  if (root) new Catalog(root, configFor(root)).start();
}
