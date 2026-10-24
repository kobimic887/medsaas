#!/usr/bin/env python3
"""Build the static, pre-sorted page data for the public stock catalog.

The public catalog (web/) is a static widget: it never calls the application
API, so it has no auth, no credits and no load on the app host. It reads
`manifest.json` plus fixed-size chunks of rows that are already sorted, so any
page in any sort order is one or two small fetches from a CDN.

INPUTS
------
--stock-csv   The import upload CSV (`smiles,ID,MAIN_BAS,...,CURRENT_TOT_NETTO_MG`)
              written by scripts/import-stock-compounds.mjs. Supplies the source
              numeric ID and the dated mg snapshot.
--canonical   The engine export (`id, MAIN_BAS, canonical_smiles`, TSV with a
              header) — the same file scripts/render-structure-images.py rendered.
              Structure images are filed under sha256(canonical_smiles), so the
              catalog must carry exactly this string, never the source `mol`.

Rows the engine did not accept (absent from --canonical) are left out and
counted in the manifest; they have no image and no searchable structure.
MW (average) and formula are computed by RDKit from the canonical SMILES.

OUTPUT (--out-dir)
------------------
    manifest.json
    sorts/<sort>/<n>.json   # rows [code, smiles, mw, formula, mg], ascending order

Each sort is stored ascending only; the widget reads descending pages from the
end. Run where RDKit is installed (the render/science hosts, not the app host):

    python3 services/stock-catalog/build_catalog.py \
        --stock-csv stock-compounds-upload.csv \
        --canonical stock-20260901-canonical.tsv \
        --out-dir ./stock-catalog-data
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool

csv.field_size_limit(sys.maxsize)

CHUNK_SIZE = 500
FIELDS = ['code', 'smiles', 'mw', 'formula', 'mg']
SORTS = ('id', 'library', 'mw', 'availability')


def describe(smiles):
    from rdkit import Chem, RDLogger
    from rdkit.Chem import Descriptors, rdMolDescriptors

    RDLogger.DisableLog('rdApp.*')
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, None
    return round(Descriptors.MolWt(mol), 3), rdMolDescriptors.CalcMolFormula(mol)


def read_stock(path):
    stock = {}
    with open(path, newline='', encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            code = row['MAIN_BAS']
            if code in stock:
                raise SystemExit(f'duplicate MAIN_BAS in {path}: {code}')
            stock[code] = {
                'id': row['ID'],
                'mg': float(row['CURRENT_TOT_NETTO_MG'] or 0),
            }
    return stock


def read_canonical(path):
    with open(path, newline='', encoding='utf-8') as handle:
        reader = csv.reader(handle, delimiter='\t')
        next(reader)
        for engine_id, code, smiles in reader:
            yield code, smiles


def library(code):
    return code.split(' ', 1)[0]


def numeric_id(source_id):
    # Source IDs keep leading zeros as strings; ordering is by number, with the
    # verbatim string as a stable tie-break.
    return int(source_id) if source_id.isdigit() else sys.maxsize


SORT_KEYS = {
    'id': lambda r: (numeric_id(r['source_id']), r['code']),
    'library': lambda r: (library(r['code']), numeric_id(r['source_id']), r['code']),
    'mw': lambda r: (r['mw'], r['code']),
    'availability': lambda r: (r['mg'], r['code']),
}


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--stock-csv', required=True)
    parser.add_argument('--canonical', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--label', default='Pyxis stock compounds')
    parser.add_argument('--snapshot', default='2026-09-01', help='date of the availability snapshot')
    parser.add_argument('--chunk-size', type=int, default=CHUNK_SIZE)
    parser.add_argument('--workers', type=int, default=os.cpu_count() or 1)
    parser.add_argument('--limit', type=int, default=0, help='first N canonical rows only (smoke tests)')
    args = parser.parse_args()

    started = time.time()
    stock = read_stock(args.stock_csv)
    pairs = []
    unmatched = 0
    for code, smiles in read_canonical(args.canonical):
        if code not in stock:
            unmatched += 1
            continue
        pairs.append((code, smiles))
        if args.limit and len(pairs) >= args.limit:
            break

    with Pool(args.workers) as pool:
        described = pool.map(describe, [smiles for _, smiles in pairs], chunksize=2000)

    rows = []
    invalid = []
    for (code, smiles), (mw, formula) in zip(pairs, described):
        if mw is None:
            invalid.append(code)
            continue
        entry = stock[code]
        rows.append({
            'code': code, 'smiles': smiles, 'mw': mw, 'formula': formula,
            'mg': round(entry['mg'], 2), 'source_id': entry['id'],
        })

    for sort in SORTS:
        ordered = sorted(rows, key=SORT_KEYS[sort])
        for index in range(0, len(ordered), args.chunk_size):
            chunk = [[r[f] for f in FIELDS] for r in ordered[index:index + args.chunk_size]]
            write_json(os.path.join(args.out_dir, 'sorts', sort, f'{index // args.chunk_size}.json'), chunk)

    libraries = {}
    for r in rows:
        libraries[library(r['code'])] = libraries.get(library(r['code']), 0) + 1
    seen = set(code for code, _ in pairs)
    manifest = {
        'version': 1,
        'label': args.label,
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'availabilitySnapshot': args.snapshot,
        'total': len(rows),
        'chunkSize': args.chunk_size,
        'fields': FIELDS,
        'sorts': list(SORTS),
        'libraries': dict(sorted(libraries.items(), key=lambda item: -item[1])),
        'excluded': {
            'notInEngine': len([code for code in stock if code not in seen]) if not args.limit else None,
            'notInStockCsv': unmatched,
            'invalidSmiles': invalid[:100],
        },
    }
    # Written last: a manifest only exists once every chunk it describes exists.
    write_json(os.path.join(args.out_dir, 'manifest.json'), manifest)
    print(json.dumps({**manifest, 'libraries': len(libraries), 'seconds': round(time.time() - started)}, indent=1))


if __name__ == '__main__':
    main()
