"""Frozen-byte import contract; runnable with standard-library Python only."""
import csv
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest

from export_index import HEADER, export
from import_stream import read_records


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.normalized = self.root / 'normalized.csv'
        def row(smiles, code):
            return [smiles, code, code, code, 'macrocycle_real', 'source.csv', '5.0', '12.1', '', '', '28 days']
        self.rows = [row('CCO', 'RPX same'), row('invalid', 'RPX rejected'), row('CCO', 'RPX same')]
        with self.normalized.open('w', newline='') as f:
            writer = csv.writer(f, lineterminator='\n')
            writer.writerow(HEADER)
            writer.writerows(self.rows)
        metadata = io.StringIO()
        writer = csv.writer(metadata, lineterminator='\n')
        writer.writerow(self.rows[0])
        first = metadata.getvalue().encode()
        writer.writerow(self.rows[2])
        indexed = metadata.getvalue().encode()
        binary = bytes([3]) + bytes(255)
        self.binary = binary
        self.counts = bytes([2, 3])
        fp = struct.pack('<QH', 0, 2) + binary + struct.pack('<QH', len(first), 2) + binary
        for suffix, value in [('rows.csv', indexed), ('fpb', fp), ('cnt', self.counts * 2)]:
            (self.root / f'real.{suffix}').write_bytes(value)
        self.manifest = {'source': 'real', 'formatVersion': 2, 'sourceRows': 3, 'indexedRows': 2,
                         'invalidSmiles': 1, 'normalizedInputSha256': hashlib.sha256(self.normalized.read_bytes()).hexdigest(),
                         'fingerprintsBytes': len(fp), 'rowsBytes': len(indexed), 'countsBytes': 4}
        (self.root / 'real.manifest.json').write_text(json.dumps(self.manifest))

    def tearDown(self):
        self.temp.cleanup()

    def stream(self):
        target = io.BytesIO()
        export('real', self.normalized, self.root, target)
        target.seek(0)
        json.loads(target.readline())
        return target

    def test_exact_bytes_duplicates_and_excluded_source_rows_survive(self):
        records = list(read_records(self.stream(), 'real', self.manifest))
        self.assertEqual([r[2] for r in records], [1, None, 2])
        self.assertEqual(records[0][11:], (self.binary, self.counts))
        self.assertEqual(records[0][3:6], records[2][3:6])
        self.assertEqual(records[1][11:], (None, None))
        self.assertEqual(str(records[0][6]), '5.0')

    def test_missing_footer_refused(self):
        data = self.stream().read().splitlines(keepends=True)
        with self.assertRaisesRegex(ValueError, 'Missing end marker'):
            list(read_records(io.BytesIO(b''.join(data[:-1])), 'real', self.manifest))

    def test_transfer_corruption_refused(self):
        data = self.stream().read().replace(b'RPX same', b'RPX edit', 1)
        with self.assertRaisesRegex(ValueError, 'checksum'):
            list(read_records(io.BytesIO(data), 'real', self.manifest))

    def test_fingerprint_count_mismatch_refused(self):
        fp_path = self.root / 'real.fpb'
        data = bytearray(fp_path.read_bytes())
        data[10] = 1
        fp_path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'popcount'):
            self.stream()

    def test_source_checksum_mismatch_refused_before_output(self):
        self.normalized.write_bytes(self.normalized.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.stream()

    def test_extra_bytes_after_footer_refused(self):
        with self.assertRaisesRegex(ValueError, 'Trailing bytes'):
            list(read_records(io.BytesIO(self.stream().read() + b'junk'), 'real', self.manifest))


if __name__ == '__main__':
    unittest.main()
