#!/usr/bin/env python3
"""Stock identifier lookup: candidate molecule ids for an exact ID/MAIN_BAS/compound_id.

The stock table has no identifier index (adding one would change the shared
database), so the identifier predicate scans ~5 GB per lookup. This file maps a
64-bit hash of every identifier text to its molecule ids. It is only a candidate
screen: stock_sql.py re-applies the original text equality to the candidates and
refuses (falls back to the full scan) when the dataset fingerprint changed.

Build (scientific host, read-only against the database; rerun after a stock import):
  nice -n 10 python3 services/owned-search/stock_ids.py --out-dir <OWNED_GRAPH_DIR> --dataset-name '<name>'
"""
import argparse, hashlib, io, json, os, pathlib, subprocess, time
import numpy as np

FORMAT_VERSION = 1
MAX_CANDIDATES = 10000  # stock_sql.py's own limit; more falls back to the scan
ENTRY = np.dtype([('key', '<u8'), ('id', '<i8')])

def key(value):
    return int.from_bytes(hashlib.sha256(value.encode('utf8')).digest()[:8], 'big')

class StockIdLookup:
    def __init__(self, directory):
        directory = pathlib.Path(directory)
        self.manifest = json.loads((directory / 'stock.ids.json').read_text())
        if self.manifest.get('formatVersion') != FORMAT_VERSION or not self.manifest.get('complete'):
            raise ValueError('Stock identifier lookup is incomplete')
        # Hash and load the same bytes (~20 MB), so a concurrent rebuild cannot
        # swap in an unverified file between the check and the load.
        raw = (directory / 'stock.ids.npy').read_bytes()
        if hashlib.sha256(raw).hexdigest() != self.manifest['sha256']:
            raise ValueError('Stock identifier lookup differs from its manifest')
        self.entries = np.load(io.BytesIO(raw))
        if self.entries.dtype != ENTRY or len(self.entries) != self.manifest['entries']:
            raise ValueError('Stock identifier lookup has an unexpected shape')
        self.keys = self.entries['key']

    def matches(self, body):
        return body.get('datasetName') == self.manifest['datasetName'] and body.get('datasetId') in (None, self.manifest['fingerprint']['datasetId'])

    def candidates(self, query):
        """Molecule ids whose identifier hash equals the query's, or None if too many."""
        k = np.uint64(key(query))
        lo, hi = int(np.searchsorted(self.keys, k, 'left')), int(np.searchsorted(self.keys, k, 'right'))
        if hi - lo > MAX_CANDIDATES: return None
        return sorted({int(i) for i in self.entries['id'][lo:hi]})

def build(out_dir, dataset_name, helper, container='tonomitosql-api-1'):
    out_dir = pathlib.Path(out_dir)
    subprocess.run(['docker', 'cp', str(helper), f'{container}:/tmp/pyxis-owned-stock-export.py'], check=True)
    process = subprocess.Popen(['docker', 'exec', '-i', '-e', 'PYTHONPATH=/app', container, 'python', '/tmp/pyxis-owned-stock-export.py'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    process.stdin.write(json.dumps({'mode': 'export_ids', 'datasetName': dataset_name})); process.stdin.close()
    header = json.loads(process.stdout.readline())
    if 'fingerprint' not in header: raise RuntimeError(f'Export failed: {header.get("error", header)}')
    keys, ids, rows, trailer = [], [], 0, None
    for line in process.stdout:
        record = json.loads(line)
        if isinstance(record, dict): trailer = record; break
        molecule, *identifiers = record
        for value in {v for v in identifiers if v}:
            keys.append(key(value)); ids.append(molecule)
        rows += 1
    if process.wait() != 0 or not trailer or not trailer.get('complete') or trailer.get('rows') != rows or rows != header['fingerprint']['rows']:
        raise RuntimeError(f'Export was incomplete: {trailer}')
    entries = np.empty(len(keys), dtype=ENTRY)
    entries['key'] = np.array(keys, dtype='<u8'); entries['id'] = np.array(ids, dtype='<i8')
    entries.sort(order=('key', 'id'))
    temporary = out_dir / f'.stock.ids.{os.getpid()}.npy'
    np.save(temporary, entries)
    manifest = {'formatVersion': FORMAT_VERSION, 'complete': True, 'datasetName': dataset_name, 'fingerprint': header['fingerprint'],
                'rows': rows, 'entries': len(entries), 'sha256': hashlib.sha256(temporary.read_bytes()).hexdigest(),
                'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    # Data first, manifest last: a reader never pairs a new manifest with old data.
    (out_dir / 'stock.ids.json').unlink(missing_ok=True)
    os.replace(temporary, out_dir / 'stock.ids.npy')
    (out_dir / '.stock.ids.json').write_text(json.dumps(manifest, indent=1))
    os.replace(out_dir / '.stock.ids.json', out_dir / 'stock.ids.json')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--dataset-name', required=True)
    args = parser.parse_args()
    manifest = build(args.out_dir, args.dataset_name, pathlib.Path(__file__).with_name('stock_sql.py'))
    print(json.dumps({k: manifest[k] for k in ('datasetName', 'rows', 'entries', 'builtAt')}))
