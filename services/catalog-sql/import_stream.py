#!/usr/bin/env python3
"""Atomic additive SQL import of export_index.py's validated NDJSON stream.

Run inside the existing scientific API runtime to reuse its DB configuration
without copying or printing credentials. Requires --apply; never replaces rows.
"""
import argparse
import base64
from datetime import date
from decimal import Decimal
import hashlib
import json
import os
import sys
import time

COLUMNS = ('source', 'source_row_number', 'index_row_id', 'smiles', 'source_id',
           'compound_code', 'web_mg', 'web_um', 'current_tot_netto_mg',
           'current_tot_amount_um', 'lead_time', 'morgan_binary', 'morgan_counts')


def read_records(stream, source, manifest):
    digest = hashlib.sha256()
    total = indexed = excluded = 0
    last_report = time.monotonic()
    for raw in stream:
        value = json.loads(raw)
        if isinstance(value, dict):
            expected = {'type': 'end', 'rows': total, 'indexed': indexed,
                        'excluded': excluded, 'rows_sha256': digest.hexdigest()}
            if value != expected or (total, indexed, excluded) != \
                    (manifest['sourceRows'], manifest['indexedRows'], manifest['invalidSmiles']):
                raise ValueError('End marker, stream checksum or manifest totals disagree')
            if stream.read(1):
                raise ValueError('Trailing bytes after end marker')
            return
        if not isinstance(value, list) or len(value) != len(COLUMNS) or value[0] != source:
            raise ValueError('Invalid source row')
        total += 1
        if value[1] != total:
            raise ValueError('Source rows are not contiguous')
        digest.update(raw)
        if value[2] is None:
            excluded += 1
            if value[11] is not None or value[12] is not None:
                raise ValueError('Excluded row unexpectedly has fingerprints')
        else:
            indexed += 1
            if value[2] != indexed:
                raise ValueError('Index rows are not contiguous')
            value[11] = base64.b64decode(value[11], validate=True)
            value[12] = base64.b64decode(value[12], validate=True)
            if len(value[11]) != 256 or sum(byte.bit_count() for byte in value[11]) != len(value[12]) \
                    or not value[12] or 0 in value[12]:
                raise ValueError('Invalid fingerprint/count pairing')
        for i in range(6, 10):
            if value[i] is not None:
                value[i] = Decimal(value[i])
                if not value[i].is_finite():
                    raise ValueError('Non-finite source quantity')
        yield tuple(value)
        if time.monotonic() - last_report > 15:
            print(json.dumps({'source': source, 'copied_rows': total}), file=sys.stderr, flush=True)
            last_report = time.monotonic()
    raise ValueError('Missing end marker: refusing a partial import')


def import_stream(stream, exported_at, min_free_gib=3):
    import psycopg
    from psycopg.types.json import Jsonb
    from app.config import settings
    header = json.loads(stream.readline())
    if header.get('type') != 'header' or header.get('version') != 1 or header.get('source') not in ('real', 'virtual'):
        raise ValueError('Invalid stream header')
    source, manifest = header['source'], header['manifest']
    if manifest.get('source') != source or manifest.get('formatVersion') != 2:
        raise ValueError('Invalid frozen index manifest')
    def check_disk():
        space = os.statvfs('/')
        if space.f_bavail * space.f_frsize < min_free_gib * 1024 ** 3:
            raise RuntimeError('Free-disk reserve reached; rolling back the import')
    check_disk()
    # Single transaction: no partially visible collection and no mutation of
    # public stock tables. Duplicate imports fail rather than overwrite data.
    # The legacy database is SQL_ASCII with UTF-8 data. Declare client encoding
    # and send JSON Unicode as UTF-8: JSONB rejects escaped non-ASCII codepoints
    # in SQL_ASCII databases. Do not change the shared database's encoding.
    with psycopg.connect(settings.database_url, application_name='pyxis_catalog_import',
                         client_encoding='UTF8') as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5s'")
            cur.execute("SET LOCAL statement_timeout = '45min'")
            cur.execute("SELECT pg_try_advisory_xact_lock(hashtext('pyxis_catalog_import'))")
            if not cur.fetchone()[0]:
                raise RuntimeError('Another catalog import is already running')
            cur.execute('INSERT INTO pyxis_catalog.imports '
                        '(source,collection_name,source_file,exported_at,source_rows,indexed_rows,excluded_rows,'
                        'normalized_sha256,artifacts_sha256,manifest) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (source, manifest['datasetName'], header['source_file'], exported_at, manifest['sourceRows'],
                         manifest['indexedRows'], manifest['invalidSmiles'], manifest['normalizedInputSha256'],
                         Jsonb(header['artifacts_sha256']),
                         Jsonb(manifest, dumps=lambda value: json.dumps(value, ensure_ascii=False))))
            with cur.copy('COPY pyxis_catalog.macrocycle_records (' + ','.join(COLUMNS) + ') FROM STDIN') as copy:
                for number, row in enumerate(read_records(stream, source, manifest), start=1):
                    if number % 25000 == 0:
                        check_disk()
                    copy.write_row(row)
            cur.execute('SELECT count(*),count(index_row_id),count(*) FILTER (WHERE index_row_id IS NULL) '
                        'FROM pyxis_catalog.macrocycle_records WHERE source=%s', (source,))
            actual = cur.fetchone()
            expected = (manifest['sourceRows'], manifest['indexedRows'], manifest['invalidSmiles'])
            if tuple(actual) != expected:
                raise ValueError(f'Database row count mismatch: {actual}')
        # context commits only after source, fingerprints and stream checks pass
    print(json.dumps({'source': source, 'committed_rows': expected[0], 'indexed': expected[1],
                      'excluded': expected[2]}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', required=True)
    parser.add_argument('--exported-at', required=True, type=date.fromisoformat)
    parser.add_argument('--min-free-gib', type=float, default=3,
                        help='Abort before filling the shared host (default: 3 GiB reserve)')
    args = parser.parse_args()
    if args.min_free_gib < 3:
        parser.error('At least 3 GiB of free-disk reserve is required')
    import_stream(sys.stdin.buffer, args.exported_at, args.min_free_gib)
