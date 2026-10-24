// Pyxis stock catalog widget (WordPress plugin asset).
//
// Mounted by the [pyxis_stock_catalog] shortcode. Pages come from the plugin's
// read-only proxy (data-api → /wp-json/pyxis-catalog/v1/compounds), which
// forwards to the Asinex stock shop; structure images load straight from the
// shop's CloudFront (compounds.asinex.com). Nothing here touches the Pyxis app
// API: no session, no credits. Order links to the web-shop.

export const SORTS = Object.freeze([
  { key: 'id', label: 'By ID', defaultOrder: 'desc' },
  { key: 'library', label: 'By library', defaultOrder: 'asc' },
  { key: 'mw', label: 'By MW', defaultOrder: 'asc' },
  { key: 'availability', label: 'By availability', defaultOrder: 'desc' },
]);
const SORT_KEYS = SORTS.map((sort) => sort.key);
const DEFAULT_SHOP_URL = 'https://app.pyxis-discovery.com/dashboard/simulation';
const DEFAULT_IMAGE_BASE = 'https://compounds.asinex.com/';
const RDKIT_SRC = 'https://cdn.jsdelivr.net/npm/@rdkit/rdkit@2026.9.1/dist/RDKit_minimal.js';
const HASH_PREFIX = 'pxc-';
const MAX_CACHED_PAGES = 30;
// Mirrors PYXIS_CATALOG_MAX_PAGE in the plugin; larger pages are refused with 400.
export const MAX_PAGE = 100000;

// ── Pure helpers (exercised by ../../../test.mjs) ─────────────────────────────

export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

// "LAS 100517730" → "LAS/1005/LAS100517730.svg", the shop's CloudFront layout.
export function imagePath(code) {
  const match = /^([A-Z0-9]+) (\d+)$/.exec(code);
  if (!match) return null;
  const [, library, digits] = match;
  return `${library}/${digits.slice(0, 4)}/${library}${digits}.svg`;
}

// The shop sends availability as display text: "17", "9.4" or ">100" (mg).
export function formatAvailable(available) {
  const text = String(available ?? '').trim();
  return text ? `${text} mg` : 'On request';
}

// "C12H14NO4-" → atoms [["C","12"],["H","14"],["N",""],["O","4"]] + charge "-".
export function formulaParts(formula) {
  const match = /^(.*?)([+-]\d*)?$/.exec(formula);
  const atoms = [...match[1].matchAll(/([A-Z][a-z]?)(\d*)/g)].map((part) => [part[1], part[2]]);
  return { atoms, charge: match[2] || '' };
}

export function readState(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const sortParam = params.get(`${HASH_PREFIX}sort`);
  const sort = SORT_KEYS.includes(sortParam) ? sortParam : 'id';
  const orderParam = params.get(`${HASH_PREFIX}order`);
  const order = orderParam === 'asc' || orderParam === 'desc'
    ? orderParam
    : SORTS.find((entry) => entry.key === sort).defaultOrder;
  const requested = Number.parseInt(params.get(`${HASH_PREFIX}page`) || '1', 10);
  const page = Number.isFinite(requested) ? Math.min(MAX_PAGE, Math.max(1, requested)) - 1 : 0;
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

let rdkitPromise = null;
// Only for structures the CDN has no picture for (it answers 403): draw the
// exact SMILES in the browser instead.
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
    this.pages = new Map();
    this.renderToken = 0;
    this.total = null;
    this.pageSize = 25;
    this.root.classList.add('pxc');
    this.root.replaceChildren();
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

  start() {
    this.renderSkeleton();
    this.syncFromHash();
  }

  syncFromHash() {
    this.state = readState(window.location.hash);
    this.render();
  }

  go(next, { scroll = true, replace = false } = {}) {
    const state = { ...this.state, ...next };
    const hash = writeState(window.location.hash, state);
    if (hash !== window.location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    this.state = state;
    this.render();
    if (scroll && this.root.getBoundingClientRect().top < 0) this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  fetchPage({ sort, order, page }) {
    const key = `${sort}/${order}/${page}`;
    if (!this.pages.has(key)) {
      const url = new URL(this.config.api, window.location.href);
      url.searchParams.set('sort', sort);
      url.searchParams.set('order', order);
      url.searchParams.set('page', String(page));
      const request = fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
        if (!response.ok) throw new Error(`catalog ${response.status}`);
        return response.json();
      });
      request.catch(() => this.pages.delete(key));
      this.pages.set(key, request);
      if (this.pages.size > MAX_CACHED_PAGES) this.pages.delete(this.pages.keys().next().value);
    }
    return this.pages.get(key);
  }

  async render() {
    const token = ++this.renderToken;
    const state = this.state;
    // Tabs and pagers are rebuilt each render; keep keyboard focus on the same control.
    const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    this.renderTabs();
    this.renderPagers();
    if (focusKey) this.root.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
    this.grid.setAttribute('aria-busy', 'true');
    if (this.total === null) this.status.textContent = 'Loading compounds…';

    let data;
    try {
      data = await this.fetchPage(state);
    } catch {
      if (token === this.renderToken) this.renderError('The catalog could not be loaded. Please try again.', () => this.render());
      return;
    }
    if (token !== this.renderToken) return;

    this.total = data.total;
    this.pageSize = data.pageSize || this.pageSize;
    const lastPage = pageCount(this.total, this.pageSize) - 1;
    if (!data.rows.length && state.page > lastPage) {
      this.go({ page: lastPage }, { scroll: false, replace: true });
      return;
    }
    const first = state.page * this.pageSize + 1;
    const last = state.page * this.pageSize + data.rows.length;
    this.status.textContent = data.rows.length
      ? `${numberFormat.format(first)}–${numberFormat.format(last)} of ${numberFormat.format(this.total)} compounds`
      : 'No compounds on this page.';
    this.renderPagers();
    if (focusKey) this.root.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
    this.grid.replaceChildren(...data.rows.map((row) => this.card(row)));
    this.grid.removeAttribute('aria-busy');
    // The shop takes a second or two per page; warm the likely next one.
    if (state.page < lastPage) this.fetchPage({ ...state, page: state.page + 1 }).catch(() => {});
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
    const known = this.total !== null;
    const pages = known ? pageCount(this.total, this.pageSize) : null;
    const { page } = this.state;
    for (const [pagerIndex, pager] of [this.topPager, this.bottomPager].entries()) {
      const input = el('input', {
        type: 'number', min: '1', max: known ? String(pages) : undefined, value: String(page + 1),
        class: 'pxc-page-input', 'aria-label': 'Page number', inputmode: 'numeric',
        'data-focus-key': `page-${pagerIndex}`,
      });
      const jump = () => {
        const value = Number.parseInt(input.value, 10);
        if (Number.isFinite(value)) this.go({ page: Math.min(pages ?? value, Math.max(1, value)) - 1 });
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
        el('span', { class: 'pxc-page-label' }, ['Page ', input, known ? ` of ${numberFormat.format(pages)}` : '']),
        button('Next page', '›', page + 1, !known || page >= pages - 1),
        button('Last page', '»', known ? pages - 1 : 0, !known || page >= pages - 1),
      );
    }
  }

  card({ code, smiles, mw, formula, available }) {
    const structure = el('div', { class: 'pxc-structure' });
    this.fillStructure(structure, code, smiles);
    const copy = el('button', {
      type: 'button', class: 'pxc-action', title: 'Copy SMILES', disabled: !smiles,
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
        el('div', {}, [el('dt', { text: 'MW' }), el('dd', { text: typeof mw === 'number' ? mw.toFixed(2) : '—' })]),
        el('div', {}, [el('dt', { text: 'Formula' }), el('dd', {}, formula ? formulaNode(formula) : '—')]),
        el('div', {}, [el('dt', { text: 'Available' }), el('dd', { text: formatAvailable(available) })]),
      ]),
      smiles && el('details', { class: 'pxc-details' }, [
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

  fillStructure(container, code, smiles) {
    const fallback = async () => {
      try {
        if (!smiles) throw new Error('no SMILES');
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
    const path = imagePath(code);
    if (!path) return fallback();
    container.replaceChildren(el('img', {
      src: new URL(path, this.config.imageBase).href,
      alt: `Structure of ${code}`, width: '300', height: '150', loading: 'lazy', decoding: 'async',
      onerror: fallback,
    }));
  }

  renderSkeleton() {
    this.grid.replaceChildren(...Array.from({ length: this.pageSize }, () => el('div', { class: 'pxc-card pxc-skeleton', 'aria-hidden': 'true' })));
  }

  renderError(message, retry) {
    this.grid.removeAttribute('aria-busy');
    this.status.textContent = '';
    this.grid.replaceChildren(el('div', { class: 'pxc-error', role: 'alert' }, [
      el('p', { text: message }),
      el('button', { type: 'button', class: 'pxc-action', onclick: retry }, 'Try again'),
    ]));
  }
}

function configFor(root) {
  return {
    api: root.dataset.api || '/wp-json/pyxis-catalog/v1/compounds',
    imageBase: (root.dataset.imageBase || DEFAULT_IMAGE_BASE).replace(/\/?$/, '/'),
    shopUrl: root.dataset.shopUrl || DEFAULT_SHOP_URL,
  };
}

function ensureStylesheet() {
  // WordPress enqueues the stylesheet; this covers pages that only add the script.
  if (document.querySelector('link[href*="pyxis-catalog.css"]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('pyxis-catalog.css', import.meta.url).href }));
}

if (typeof document !== 'undefined') {
  ensureStylesheet();
  // One catalog per page: the URL hash holds its state.
  const root = document.querySelector('[data-pyxis-catalog]');
  if (root) new Catalog(root, configFor(root)).start();
}
