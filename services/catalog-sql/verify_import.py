#!/usr/bin/env python3
"""Read-only full-row digest: compare an export stream with committed SQL rows."""
import argparse
import gzip
import hashlib
import json
from decimal import Decimal

from import_stream import COLUMNS, read_records


def digest_rows(rows):
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        # Numeric scale is insignificant, unlike original textual IDs/SMILES.
        values = list(row[:11])
        for index in range(6, 10):
            if values[index] is not None:
                value = Decimal(values[index])
                text = format(value, 'f')
                values[index] = text.rstrip('0').rstrip('.') if '.' in text else text
                if value == 0:
                    values[index] = '0'
        data = json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        for field in (data, row[11], row[12]):
            if field is None:
                digest.update(b'NULL;')
            else:
                digest.update(str(len(field)).encode('ascii') + b':' + field)
        count += 1
    return {'rows': count, 'sha256': digest.hexdigest()}


def database_digest(source):
    import psycopg
    from app.config import settings
    with psycopg.connect(settings.database_url, client_encoding='UTF8',
                         application_name='pyxis_catalog_verify') as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        conn.execute("SET LOCAL statement_timeout = '15min'")
        with conn.cursor(name='catalog_verify') as cur:
            cur.itersize = 5000
            cur.execute('SELECT ' + ','.join(COLUMNS) +
                        ' FROM pyxis_catalog.macrocycle_records WHERE source=%s ORDER BY source_row_number',
                        (source,))
            return digest_rows(cur)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--stream', help='Local .ndjson.gz export')
    group.add_argument('--database', choices=('real', 'virtual'))
    args = parser.parse_args()
    if args.stream:
        with gzip.open(args.stream, 'rb') as stream:
            header = json.loads(stream.readline())
            result = digest_rows(read_records(stream, header['source'], header['manifest']))
    else:
        result = database_digest(args.database)
    print(json.dumps(result))
