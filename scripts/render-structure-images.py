#!/usr/bin/env python3
"""Render static RDKit SVG structure images for CDN hosting.

KEY CONTRACT
------------
Each image is addressed by the SHA-256 of the *exact* SMILES string the client
receives (UTF-8, no trimming beyond the TSV field, no canonicalization):

    <sha[0:2]>/<sha[2:4]>/<sha>.svg

For stock search that string is the engine's `canonical_smiles` (tonomitosql
`molecules.canonical_smiles`), NOT the source file's `mol` column. Hashing a
different SMILES spelling of the same molecule finds no image, which is the safe
failure: the client keeps rendering with browser RDKit. Never re-key an image to
a "similar" SMILES — a picture must depict exactly the string it is filed under.

USAGE
-----
    # TSV/CSV with a header; SMILES from the named column. '-' reads stdin.
    python3 scripts/render-structure-images.py \
        --input stock.tsv --smiles-column canonical_smiles --out-dir ./images

    # Render host without disk headroom: copy the script there, pipe SMILES in
    # and the tar back out (compressed in transit).
    ssh host 'python3 /tmp/render-structure-images.py --input - --tar - | zstd -1 -c' \
        < stock.tsv | zstd -dc | tar -xf - -C ./images

Complete files in --out-dir are skipped, so re-runs only render what is missing.
After an interrupted remote --tar run, resume with only the missing SMILES:

    python3 scripts/render-structure-images.py --input stock.tsv \
        --out-dir ./images --print-missing > missing.tsv
Invalid SMILES are listed in --failures (TSV: smiles, reason) and never drawn.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import tarfile
import time
from multiprocessing import Pool

WIDTH = 300
HEIGHT = 150

csv.field_size_limit(sys.maxsize)


def image_key(smiles):
    return hashlib.sha256(smiles.encode('utf-8')).hexdigest()


def image_path(key):
    return f'{key[0:2]}/{key[2:4]}/{key}.svg'


def render(smiles):
    # Imported per worker so the parent stays light when only reading input.
    from rdkit import Chem, RDLogger
    from rdkit.Chem.Draw import rdMolDraw2D

    RDLogger.DisableLog('rdApp.*')
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return smiles, None, 'invalid SMILES'
    try:
        drawer = rdMolDraw2D.MolDraw2DSVG(WIDTH, HEIGHT)
        rdMolDraw2D.PrepareAndDrawMolecule(drawer, mol)
        drawer.FinishDrawing()
        svg = drawer.GetDrawingText()
    except Exception as error:  # RDKit raises assorted runtime errors on odd input
        return smiles, None, f'draw failed: {error}'
    if '<svg' not in svg:
        return smiles, None, 'no SVG output'
    return smiles, svg.encode('utf-8'), None


def read_smiles(source, column):
    handle = sys.stdin if source == '-' else open(source, newline='', encoding='utf-8')
    with handle:
        first = handle.readline()
        delimiter = '\t' if '\t' in first else ','
        header = next(csv.reader([first], delimiter=delimiter))
        if column not in header:
            raise SystemExit(f'Column {column!r} not in header: {header}')
        index = header.index(column)
        seen = set()
        for row in csv.reader(handle, delimiter=delimiter):
            if len(row) <= index:
                continue
            smiles = row[index]
            if smiles and smiles not in seen:
                seen.add(smiles)
                yield smiles


def is_complete(path):
    # A dropped tar stream can leave a truncated last file; only a closed <svg>
    # counts as rendered.
    try:
        with open(path, 'rb') as handle:
            handle.seek(max(0, os.path.getsize(path) - 16))
            return handle.read().rstrip().endswith(b'</svg>')
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', required=True, help="TSV/CSV path, or '-' for stdin")
    parser.add_argument('--smiles-column', default='canonical_smiles')
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument('--out-dir', help='write sharded SVG files here')
    output.add_argument('--tar', help="write an uncompressed tar here ('-' = stdout)")
    parser.add_argument('--failures', help='TSV of SMILES that could not be drawn')
    parser.add_argument('--manifest', help='JSON run summary')
    parser.add_argument('--workers', type=int, default=os.cpu_count() or 1)
    parser.add_argument('--limit', type=int, default=0, help='only the first N distinct SMILES')
    parser.add_argument('--print-missing', action='store_true',
                        help='with --out-dir: print SMILES lacking a complete SVG (TSV) and exit; no RDKit needed')
    args = parser.parse_args()

    if args.print_missing:
        if not args.out_dir:
            raise SystemExit('--print-missing needs --out-dir')
        print(args.smiles_column)
        for smiles in read_smiles(args.input, args.smiles_column):
            if not is_complete(os.path.join(args.out_dir, image_path(image_key(smiles)))):
                print(smiles)
        return

    from rdkit import rdBase

    started = time.time()
    smiles_iter = read_smiles(args.input, args.smiles_column)
    todo = []
    skipped = 0
    for smiles in smiles_iter:
        if args.limit and len(todo) + skipped >= args.limit:
            break
        if args.out_dir and is_complete(os.path.join(args.out_dir, image_path(image_key(smiles)))):
            skipped += 1
            continue
        todo.append(smiles)

    tar = None
    if args.tar:
        stream = sys.stdout.buffer if args.tar == '-' else open(args.tar, 'wb')
        tar = tarfile.open(fileobj=stream, mode='w|')

    failures = []
    written = 0
    with Pool(args.workers) as pool:
        for smiles, svg, reason in pool.imap_unordered(render, todo, chunksize=256):
            if svg is None:
                failures.append((smiles, reason))
                continue
            relative = image_path(image_key(smiles))
            if tar:
                info = tarfile.TarInfo(relative)
                info.size = len(svg)
                info.mtime = int(started)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(svg))
            else:
                target = os.path.join(args.out_dir, relative)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                temporary = f'{target}.tmp'
                with open(temporary, 'wb') as out:
                    out.write(svg)
                os.replace(temporary, target)
            written += 1
            if written % 50000 == 0:
                print(f'rendered {written}/{len(todo)}', file=sys.stderr, flush=True)

    if tar:
        tar.close()

    if args.failures:
        with open(args.failures, 'w', newline='', encoding='utf-8') as out:
            writer = csv.writer(out, delimiter='\t', lineterminator='\n')
            writer.writerow(['smiles', 'reason'])
            writer.writerows(failures)

    summary = {
        'rdkit': rdBase.rdkitVersion,
        'width': WIDTH,
        'height': HEIGHT,
        'key': 'sha256(utf-8 exact SMILES)',
        'layout': '<sha[0:2]>/<sha[2:4]>/<sha>.svg',
        'distinct_smiles': len(todo) + skipped,
        'skipped_existing': skipped,
        'rendered': written,
        'failed': len(failures),
        'seconds': round(time.time() - started, 1),
    }
    if args.manifest:
        with open(args.manifest, 'w', encoding='utf-8') as out:
            json.dump(summary, out, indent=2)
    print(json.dumps(summary), file=sys.stderr)


if __name__ == '__main__':
    main()
