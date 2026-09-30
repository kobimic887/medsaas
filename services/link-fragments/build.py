#!/usr/bin/env python3
"""Build an atomic, compressed SQLite index of owned 3D linker conformations.
No molecule coordinates, labels, charges or identifiers are repaired during import.
The archive is streamed; the uncompressed multi-GB SDF is never written to disk.
"""
import argparse
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sqlite3
import zipfile
import zlib


def descriptors(record):
    lines = record.splitlines()
    if len(lines) < 5 or 'V2000' not in lines[3]:
        raise ValueError('Only V2000 records supported')
    na, nb = int(lines[3][:3]), int(lines[3][3:6])
    if not 2 <= na <= 500 or not 1 <= nb <= 700:
        raise ValueError('Atom/bond limits')
    atoms = []
    for line in lines[4:4+na]:
        pos = [float(line[i:i+10]) for i in (0, 10, 20)]
        if not all(math.isfinite(v) for v in pos):
            raise ValueError('Nonfinite coordinate')
        atoms.append((line[31:34].strip(), pos))
    labels = [i for i, a in enumerate(atoms) if a[0] == 'He']
    if not 2 <= len(labels) <= 8:
        raise ValueError('Two to eight He labels required')
    bonds = []
    for line in lines[4+na:4+na+nb]:
        a, b, order = int(line[:3])-1, int(line[3:6])-1, int(line[6:9])
        if not 0 <= a < na or not 0 <= b < na or order not in (1, 2, 3, 4):
            raise ValueError('Invalid bond')
        bonds.append((a, b, order))
    anchors = {}
    for label in labels:
        near = [(b if a == label else a, o) for a, b, o in bonds if label in (a, b)]
        if len(near) != 1 or near[0][1] != 1 or atoms[near[0][0]][0] in ('He', 'H'):
            raise ValueError('He must label one single-bonded heavy atom')
        n = atoms[near[0][0]][1]
        v = [atoms[label][1][i]-n[i] for i in range(3)]
        norm = math.sqrt(sum(x*x for x in v))
        if norm < 0.1 or norm > 3:
            raise ValueError('Degenerate label bond')
        # He marks a hydrogen-length exit vector. Index nominal carbon
        # connection anchors at 1.5 A; search includes a conservative margin.
        anchors[label] = [n[i]+1.5*v[i]/norm for i in range(3)]
    pairs = []
    for a, b in itertools.combinations(labels, 2):
        d = math.dist(anchors[a], anchors[b])
        if d > 0.1:
            pairs.append((a+1, b+1, d))
    if not pairs:
        raise ValueError('No distinct anchors')
    code = ''
    for i, line in enumerate(lines):
        if line.startswith('>') and '<IDNUMBER>' in line and i+1 < len(lines):
            code = lines[i+1].strip()[:200]
    return pairs, code


def build(input_path, output_path, expected=None):
    output = Path(output_path)
    partial = output.with_name(output.name+'.partial')
    if output.exists() or partial.exists():
        raise ValueError('Choose a new output path; existing indexes are never overwritten')
    output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(partial)
    conn.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE conformers(id INTEGER PRIMARY KEY, linker_id TEXT NOT NULL, sdf_zlib BLOB NOT NULL);
CREATE TABLE pairs(conformer_id INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL, distance REAL NOT NULL);
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);''')
    rows = accepted = rejected = pair_count = 0
    reasons = {}
    archive = zipfile.ZipFile(input_path)
    files = [f for f in archive.infolist() if f.filename.lower().endswith('.sdf') and not f.is_dir()]
    if len(files) != 1 or files[0].file_size > 8_000_000_000:
        raise ValueError('Archive must contain one bounded SDF')
    digest = hashlib.sha256()
    with open(input_path, 'rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            digest.update(block)
    pending = []
    with archive.open(files[0]) as stream:
        for raw in stream:
            if raw.strip() == b'$$$$':
                rows += 1
                record = b''.join(pending).decode('utf-8')
                pending = []
                try:
                    pairs, code = descriptors(record)
                    conn.execute('INSERT INTO conformers VALUES (?,?,?)', (rows, code or f'row-{rows}', zlib.compress(record.encode(), 1)))
                    conn.executemany('INSERT INTO pairs VALUES (?,?,?,?)', [(rows, *p) for p in pairs])
                    accepted += 1
                    pair_count += len(pairs)
                except (ValueError, IndexError) as error:
                    rejected += 1
                    reason = str(error)
                    reasons[reason] = reasons.get(reason, 0)+1
                if rows % 10000 == 0:
                    conn.commit()
                    print(json.dumps({'rows': rows, 'accepted': accepted, 'rejected': rejected}), flush=True)
            else:
                pending.append(raw)
                if sum(map(len, pending)) > 200000:
                    raise ValueError('Oversized record')
    if any(line.strip() for line in pending):
        raise ValueError('Unterminated final SDF record')
    if expected is not None and rows != expected:
        raise ValueError(f'Expected {expected} rows, found {rows}')
    if not accepted or rejected > rows*.02:
        raise ValueError(f'Index rejected too many records: {rejected}/{rows}')
    report = {'formatVersion': 1, 'sourceRows': rows, 'records': accepted, 'pairs': pair_count,
              'rejected': rejected, 'reasons': reasons, 'sourceSha256': digest.hexdigest(),
              'method': 'Pyxis rigid two-fragment geometry; nominal 1.5 A anchors', 'sourceFile': files[0].filename}
    conn.execute('CREATE INDEX pairs_distance ON pairs(distance)')
    conn.execute('INSERT INTO metadata VALUES (?,?)', ('manifest', json.dumps(report)))
    conn.commit()
    if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('Index integrity check failed')
    conn.close()
    os.replace(partial, output)
    output.with_suffix('.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--expected-rows', type=int)
    args = parser.parse_args()
    print(json.dumps(build(args.input, args.out, args.expected_rows)), flush=True)
