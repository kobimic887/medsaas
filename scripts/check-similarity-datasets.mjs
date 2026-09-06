// Executes the real component with lightweight hook/element adapters. Optional
// STOCK_SEARCH_BASE exercises reads against an isolated, already imported dataset.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const state = [], effects = [], refs = [];
let cursor = 0, pending = [], requests = [], responder;
const element = (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } });
globalThis.__pickerHarness = {
  createElement: element, jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), jsxDEV: (type, props) => ({ type, props }),
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
  useRef(initial) { const i = cursor++; return refs[i] ||= { current: initial }; },
  useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((d, j) => d !== effects[i][j])) { effects[i] = deps; pending.push(fn); } },
};
const build = await Bun.build({
  entrypoints: [resolve('client/src/pages/dashboard/deep-similarity.jsx')],
  target: 'bun',
  plugins: [{ name: 'component-adapters', setup(builder) {
    builder.onResolve({ filter: /^(react(?:\/.*)?|@material-tailwind\/react|@heroicons\/react\/24\/outline|@\/utils\/constants)$/ }, args => ({ path: args.path, namespace: 'adapter' }));
    builder.onLoad({ filter: /.*/, namespace: 'adapter' }, ({ path }) => ({ contents:
      path.startsWith('react') ? 'export const {useState,useRef,useEffect,createElement,jsx,jsxs,jsxDEV}=globalThis.__pickerHarness; export default globalThis.__pickerHarness;' :
      path.includes('constants') ? 'export const API_CONFIG={buildUrl:p=>p}; export const getAuthToken=()=>"test-token";' :
      'export const Card="Card",CardBody="CardBody",CardHeader="CardHeader",Typography="Typography",Button="Button",Input="Input",Spinner="Spinner",Alert="Alert",AdjustmentsHorizontalIcon="Icon",BeakerIcon="Icon",MagnifyingGlassIcon="Icon",SparklesIcon="Icon";', loader: 'js' }));
  } }],
});
assert.equal(build.success, true, String(build.logs));
const { DeepSimilarity } = await import(URL.createObjectURL(build.outputs[0]));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => { requests.push({ url, options }); return responder(url, options); };
const render = () => { cursor = 0; return DeepSimilarity(); };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const find = (tree, predicate) => { const node = nodes(tree).find(predicate); assert.ok(node, 'Control exists'); return node; };
const flush = async () => { pending.splice(0).forEach(fn => fn()); await new Promise(r => setTimeout(r, 20)); };
try {
  responder = async () => Response.json({ datasets: [{ id: 10, name: 'Stock compounds — 2026-09-01', row_count: 630646 }] });
  render(); await flush();
  let tree = render();
  assert.equal(requests[0].url, '/tanimoto/v1/datasets');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
  const picker = () => find(tree, n => n.props?.['aria-label'] === 'Dataset');
  assert.equal(picker().props.value, '');
  assert.ok(nodes(tree).some(n => n.type === 'option' && n.props.value === '10'));
  picker().props.onChange({ target: { value: '10' } });
  tree = render();
  find(tree, n => n.type === 'Input').props.onChange({ target: { value: 'C[NH3+]' } });
  responder = async () => Response.json({ results: [] });
  for (const mode of ['exact', 'similarity', 'substructure']) {
    tree = render();
    find(tree, n => n.props?.['aria-label'] === 'Search mode').props.onChange({ target: { value: mode } });
    tree = render();
    find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    await flush();
    const request = requests.at(-1), url = new URL(request.url, 'http://test');
    assert.equal(url.pathname, `/tanimoto/v1/search/${mode}`);
    assert.equal(url.searchParams.get('dataset_id'), '10');
    assert.equal(url.searchParams.get('smiles'), 'C[NH3+]');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  }
  tree = render(); picker().props.onChange({ target: { value: '' } });
  tree = render(); find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.equal(new URL(requests.at(-1).url, 'http://test').searchParams.has('dataset_id'), false);
  // Re-mount into a failed listing, then retry successfully.
  state.length = effects.length = refs.length = 0;
  responder = async () => Response.json({ error: 'unavailable' }, { status: 503 });
  render(); await flush(); tree = render();
  assert.ok(nodes(tree).some(n => n.props?.role === 'alert'));
  responder = async () => Response.json({ datasets: [] });
  find(tree, n => n.type === 'button').props.onClick(); render(); await flush(); tree = render();
  assert.ok(!nodes(tree).some(n => n.props?.role === 'alert'));
  if (process.env.STOCK_SEARCH_BASE) {
    const base = process.env.STOCK_SEARCH_BASE;
    const listing = await (await realFetch(`${base}/v1/datasets`)).json();
    const stock = listing.datasets.find(d => d.name === 'Stock compounds — 2026-09-01');
    assert.ok(stock?.row_count > 0);
    console.log(`Real isolated service: stock dataset ${stock.id}, ${stock.row_count} compounds available to picker contract`);
  }
  console.log('Similarity dataset component: listing, auth, three scoped search modes, all-dataset fallback, failure and retry passed');
} finally { globalThis.fetch = realFetch; delete globalThis.__pickerHarness; }
