/** Strict, coordinate-preserving V2000 subset. Unsupported chemistry is rejected. */
export class LinkFragmentsError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.detail };
  }
}
const fail = (code, message) => {
  throw new LinkFragmentsError(code, message);
};
const chargeCodes = [0, 3, 2, 1, 0, -1, -2, -3];
const integer = (s) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : NaN);
// V2000 atom-block mass differences (columns 35-36) are relative to the most
// common isotope; values match RDKit's getMostCommonIsotope. A nonzero mass
// difference on any other element is refused instead of guessed.
const MOST_COMMON_ISOTOPE = Object.freeze({
  H: 1, He: 4, Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
  Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35, Ar: 40, K: 39,
  Ca: 40, Ti: 48, V: 51, Cr: 52, Mn: 55, Fe: 56, Co: 59, Ni: 58, Cu: 63,
  Zn: 64, Ga: 69, Ge: 74, As: 75, Se: 80, Br: 79, Kr: 84, Rb: 85, Sr: 88,
  Mo: 98, Ru: 102, Rh: 103, Pd: 106, Ag: 107, Cd: 114, In: 115, Sn: 120,
  Sb: 121, Te: 130, I: 127, Xe: 132, Cs: 133, Ba: 138, Pt: 195, Au: 197,
  Hg: 202, Tl: 205, Pb: 208, Bi: 209,
});
function massDifferenceIsotope(field, element, i) {
  const difference = field.trim() ? integer(field) : 0;
  if (!Number.isInteger(difference))
    fail('UNSUPPORTED_ATOM', `Atom ${i + 1} has an invalid mass difference.`);
  if (!difference) return null;
  const isotope = (MOST_COMMON_ISOTOPE[element] ?? NaN) + difference;
  if (!(isotope >= 1))
    fail(
      'UNSUPPORTED_ATOM',
      `Atom ${i + 1}: use M  ISO for the ${element} isotope; its atom-block mass difference is not supported.`,
    );
  return isotope;
}
export function parseSdf(input) {
  if (typeof input !== 'string' || input.length > 20_000_000)
    fail('INVALID_SDF', 'Supply an SDF text under 20 MB.');
  return input
    .replaceAll('\r', '')
    .split('$$$$')
    .map((s, i) => (i ? s.replace(/^\n/, '') : s))
    .filter((s) => s.trim())
    .map(parseMolBlock);
}
export function parseMolBlock(record) {
  const lines = record.replaceAll('\r', '').split('\n');
  // A blank molecule title is significant; only strip the separator newline.
  if (!lines[3]?.includes('V2000'))
    fail(
      'UNSUPPORTED_SDF',
      'Only V2000 molecules are supported; V3000 and query records are refused.',
    );
  const count = lines[3];
  const na = integer(count.slice(0, 3));
  const nb = integer(count.slice(3, 6));
  if (!(na > 0 && na <= 999 && nb >= 0 && nb <= 999))
    fail('INVALID_SDF', 'Invalid V2000 atom or bond count.');
  const atoms = lines.slice(4, 4 + na).map((line, i) => {
    const xyz = [0, 10, 20].map((p) => Number(line.slice(p, p + 10)));
    const element = line.slice(31, 34).trim();
    const code = integer(line.slice(36, 39));
    if (
      line.length < 48 ||
      [0, 10, 20].some((p) => !line.slice(p, p + 10).trim()) ||
      xyz.some((v) => !Number.isFinite(v)) ||
      !/^[A-Z][a-z]?$/.test(element) ||
      !(code >= 0 && code <= 7) ||
      code === 4
    )
      fail(
        'UNSUPPORTED_ATOM',
        `Unsupported atom ${i + 1}, query atom or radical.`,
      );
    return {
      element,
      xyz,
      charge: chargeCodes[code],
      // M  ISO later overrides this per listed atom, as RDKit does.
      isotope: massDifferenceIsotope(line.slice(34, 36), element, i),
      parity: integer(line.slice(39, 42)) || 0,
      tail: line.slice(34),
    };
  });
  if (atoms.length !== na) fail('INVALID_SDF', 'Truncated atom block.');
  const bonds = lines.slice(4 + na, 4 + na + nb).map((line) => {
    const a = integer(line.slice(0, 3)) - 1,
      b = integer(line.slice(3, 6)) - 1,
      order = integer(line.slice(6, 9));
    if (
      !(
        a >= 0 &&
        b >= 0 &&
        a < na &&
        b < na &&
        a !== b &&
        [1, 2, 3, 4].includes(order)
      )
    )
      fail('UNSUPPORTED_BOND', 'Invalid bond or unsupported query bond.');
    return { a, b, order, tail: line.slice(9) };
  });
  if (
    new Set(bonds.map((b) => [b.a, b.b].sort((a, z) => a - z).join(':')))
      .size !== bonds.length
  )
    fail('INVALID_SDF', 'Duplicate bonds are not supported.');
  let ended = false;
  let chargePropertySeen = false;
  const properties = [];
  for (let i = 4 + na + nb; i < lines.length; i++) {
    const line = lines[i];
    if (line === 'M  END') {
      ended = true;
      properties.push(...lines.slice(i + 1));
      break;
    }
    if (/^M {2}(CHG|ISO)/.test(line)) {
      const kind = line.slice(3, 6),
        n = integer(line.slice(6, 9));
      if (!(n > 0 && n <= 8)) fail('INVALID_SDF', 'Malformed atom property.');
      // V2000 M CHG takes precedence over all atom-block charge codes.
      if (kind === 'CHG' && !chargePropertySeen) {
        for (const atom of atoms) atom.charge = 0;
        chargePropertySeen = true;
      }
      for (let j = 0; j < n; j++) {
        const a = integer(line.slice(10 + j * 8, 14 + j * 8)) - 1;
        const value = integer(line.slice(14 + j * 8, 18 + j * 8));
        if (!atoms[a] || !Number.isInteger(value))
          fail('INVALID_SDF', 'Malformed atom property.');
        atoms[a][kind === 'CHG' ? 'charge' : 'isotope'] = value;
      }
    } else if (line.trim())
      fail(
        'UNSUPPORTED_SDF',
        'Unsupported V2000 property (including radicals, atom aliases and query constraints).',
      );
  }
  if (!ended) fail('INVALID_SDF', 'Missing M END.');
  return {
    title: lines[0],
    atoms,
    bonds,
    properties,
    is3D: lines[1]?.includes('3D'),
    chiral: integer(count.slice(12, 15)) || 0,
  };
}
export function neighbors(molecule, index) {
  return molecule.bonds
    .filter((b) => b.a === index || b.b === index)
    .map((b) => ({ index: b.a === index ? b.b : b.a, order: b.order }));
}
const field = (n, width = 3) => String(n).padStart(width);
export function writeMolBlock(molecule) {
  if (molecule.atoms.length > 999 || molecule.bonds.length > 999)
    fail('UNSUPPORTED_SDF', 'Product exceeds V2000 size limits.');
  const lines = [
    molecule.title || 'Pyxis Link Fragments',
    '  Pyxis             3D', // V2000 dimension code occupies columns 21-22.
    '',
    `${field(molecule.atoms.length)}${field(molecule.bonds.length)}  0  0${field(molecule.chiral || 0)}  0  0  0  0  0999 V2000`,
  ];
  for (const a of molecule.atoms) {
    if (a.xyz.some((v) => !Number.isFinite(v) || Math.abs(v) > 9999))
      fail(
        'INVALID_COORDINATES',
        'Coordinates cannot be represented in V2000.',
      );
    let tail = a.tail || '  0  0  0  0  0  0  0  0  0  0  0  0';
    // Isotopes are written only as absolute M  ISO (mass difference 0), charges
    // only as M  CHG; the remaining atom flags are preserved verbatim.
    tail = field(0, 2) + field(0) + field(a.parity || 0) + tail.slice(8);
    lines.push(
      a.xyz.map((v) => v.toFixed(4).padStart(10)).join('') +
        ` ${a.element.padEnd(3)}` +
        tail,
    );
  }
  for (const b of molecule.bonds)
    lines.push(
      `${field(b.a + 1)}${field(b.b + 1)}${field(b.order)}${b.tail || '  0  0  0  0'}`,
    );
  for (const [key, kind] of [
    ['charge', 'CHG'],
    ['isotope', 'ISO'],
  ]) {
    const rows = molecule.atoms.flatMap((a, i) =>
      a[key] ? [[i + 1, a[key]]] : [],
    );
    for (let i = 0; i < rows.length; i += 8) {
      const part = rows.slice(i, i + 8);
      lines.push(
        `M  ${kind}${field(part.length)}` +
          part.map(([a, v]) => `${field(a, 4)}${field(v, 4)}`).join(''),
      );
    }
  }
  lines.push('M  END');
  return lines.join('\n') + '\n';
}
const DATA_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
/** SD data items (`> <KEY>` + value lines + blank line). Values never span records. */
function dataItems(data = {}) {
  // Array.map(writeSdf) passes an index here; only a plain object is data.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  return Object.entries(data)
    .map(([key, value]) => {
      if (!DATA_KEY.test(key))
        fail('INVALID_SDF_DATA', 'SD data keys use letters, digits, _ . : -.');
      if (value === undefined || value === null) return '';
      const text = String(value).replaceAll('\r', '');
      if (text.includes('$$$$'))
        fail('INVALID_SDF_DATA', 'SD data values cannot contain $$$$.');
      // A blank line ends an SD value, so blank lines inside it are dropped.
      const lines = text.split('\n').filter((line) => line.trim());
      return `> <${key}>\n${lines.join('\n')}\n\n`;
    })
    .join('');
}
export function writeSdf(molecule, data) {
  return `${writeMolBlock(molecule)}${dataItems(data)}$$$$\n`;
}
/** Add or replace SD data items in every record, before its $$$$ separator. */
export function withSdfData(sdfText, data) {
  if (typeof sdfText !== 'string')
    fail('INVALID_SDF', 'Supply SDF text to annotate.');
  const items = dataItems(data),
    keys = new Set(Object.keys(data));
  const records = sdfText.replaceAll('\r', '').split(/^\$\$\$\$[^\n]*\n?/m);
  if (records.length > 1 && !records.at(-1).trim()) records.pop();
  return records
    .map((record) => {
      const lines = record.replace(/\n+$/, '').split('\n'),
        end = lines.indexOf('M  END');
      if (end < 0) fail('INVALID_SDF', 'Missing M END.');
      const kept = lines.slice(0, end + 1);
      // Drop existing items with the same key: header line through its blank terminator.
      for (let i = end + 1, skip = false; i < lines.length; i++) {
        const key = /^>.*<([^>]+)>/.exec(lines[i])?.[1];
        if (key !== undefined) skip = keys.has(key);
        if (!skip) kept.push(lines[i]);
        else if (!lines[i].trim()) skip = false;
      }
      while (kept.length > end + 1 && !kept.at(-1).trim()) kept.pop();
      // Terminate the last retained item with its blank line.
      return `${kept.join('\n')}\n${kept.length > end + 1 ? '\n' : ''}${items}$$$$\n`;
    })
    .join('');
}
