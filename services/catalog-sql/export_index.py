#!/usr/bin/env python3
"""Stream complete source rows and exact frozen index bytes; never re-fingerprint.

The NDJSON footer is mandatory: a broken pipe, failed validation, or truncated
transfer must never look like a complete import to import_stream.py.
"""
import argparse
import base64
import csv
import hashlib
import json
from pathlib import Path
import struct
import sys

HEADER = ['smiles', 'ID', 'MAIN_BAS', 'compound_id', 'source', 'source_file',
          'web_mg', 'web_uM', 'CURRENT_TOT_NETTO_MG', 'CURRENT_TOT_AMOUNT_UM', 'Lead_TIME']
RECORD_BYTES = 266


def digest_file(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def parse_line(line):
    return next(csv.reader([line.decode('utf-8').rstrip('\r\n')]))


def export(source, normalized, index_dir, output):
    manifest_path = index_dir / f'{source}.manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('source') != source or manifest.get('formatVersion') != 2:
        raise ValueError('Expected the selected source with a format-2 index')
    if digest_file(normalized) != manifest['normalizedInputSha256']:
        raise ValueError('Normalized source SHA-256 does not match the frozen index')
    paths = {suffix: index_dir / f'{source}.{suffix}' for suffix in ('fpb', 'cnt', 'rows.csv', 'manifest.json')}
    hashes = {path.name: digest_file(path) for path in paths.values()}
    for suffix, size_key in [('fpb', 'fingerprintsBytes'), ('cnt', 'countsBytes'), ('rows.csv', 'rowsBytes')]:
        if paths[suffix].stat().st_size != manifest[size_key]:
            raise ValueError(f'Wrong artifact size: {suffix}')

    def emit(value):
        data = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        output.write(data)
        return data

    row_digest = hashlib.sha256()
    indexed = excluded = total = 0
    with open(normalized, 'rb') as original, open(paths['rows.csv'], 'rb') as rows, \
            open(paths['fpb'], 'rb') as fingerprints, open(paths['cnt'], 'rb') as counts:
        if parse_line(original.readline()) != HEADER:
            raise ValueError('Unexpected normalized header')
        first_line = original.readline()
        if not first_line:
            raise ValueError('Empty normalized source')
        first_fields = parse_line(first_line)
        emit({'type': 'header', 'version': 1, 'source': source, 'manifest': manifest,
              'source_file': first_fields[5], 'artifacts_sha256': hashes})
        indexed_offset = rows.tell()
        next_indexed = rows.readline()
        for raw_line in __import__('itertools').chain([first_line], original):
            fields = parse_line(raw_line)
            if len(fields) != len(HEADER) or fields[4] != f'macrocycle_{source}' \
                    or fields[2] != fields[3] or fields[5] != first_fields[5]:
                raise ValueError('Unexpected source columns or identity')
            total += 1
            index_id = binary = frequencies = None
            if next_indexed and fields == parse_line(next_indexed):
                record = fingerprints.read(RECORD_BYTES)
                if len(record) != RECORD_BYTES:
                    raise ValueError('Truncated fingerprint record')
                metadata_offset, bit_count = struct.unpack('<QH', record[:10])
                binary = record[10:]
                if metadata_offset != indexed_offset or sum(byte.bit_count() for byte in binary) != bit_count:
                    raise ValueError('Fingerprint metadata offset or popcount mismatch')
                frequencies = counts.read(bit_count)
                if len(frequencies) != bit_count or not bit_count or 0 in frequencies:
                    raise ValueError('Truncated or invalid count stream')
                indexed += 1
                index_id = indexed
                indexed_offset = rows.tell()
                next_indexed = rows.readline()
            else:
                excluded += 1
            # Original rows excluded from the scientific index are retained in
            # SQL with NULL fingerprint fields, never silently discarded.
            row = [source, total, index_id, fields[0], fields[1], fields[2],
                   *[value if value != '' else None for value in fields[6:11]],
                   base64.b64encode(binary).decode() if binary is not None else None,
                   base64.b64encode(frequencies).decode() if frequencies is not None else None]
            row_digest.update(emit(row))
        if next_indexed or fingerprints.read(1) or counts.read(1):
            raise ValueError('Unconsumed index bytes or metadata rows')
    if (total, indexed, excluded) != (manifest['sourceRows'], manifest['indexedRows'], manifest['invalidSmiles']):
        raise ValueError(f'Row totals disagree with manifest: {total}, {indexed}, {excluded}')
    emit({'type': 'end', 'rows': total, 'indexed': indexed, 'excluded': excluded,
          'rows_sha256': row_digest.hexdigest()})
    output.flush()
    return total, indexed, excluded


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, choices=['real', 'virtual'])
    parser.add_argument('--normalized', required=True, type=Path)
    parser.add_argument('--index-dir', required=True, type=Path)
    args = parser.parse_args()
    export(args.source, args.normalized, args.index_dir, sys.stdout.buffer)
