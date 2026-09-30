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
      isotope: null,
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
    '  Pyxis            3D',
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
    // Preserve isotope mass differences and remaining atom flags; absolute ISO/CHG follow.
    tail = tail.slice(0, 2) + field(0) + field(a.parity || 0) + tail.slice(8);
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
export function writeSdf(molecule) {
  return `${writeMolBlock(molecule)}$$$$\n`;
}
