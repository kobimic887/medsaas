-- Additive, one-time organization of supplier exports and their existing calculations.
-- Run in a transaction; deliberately fail if the schema already exists.
-- Requires PostgreSQL 14+ (bit_count(bytea)) and the existing RDKit stock schema.
-- No grants or role changes: existing privileged operators control access.
CREATE SCHEMA pyxis_catalog;
COMMENT ON SCHEMA pyxis_catalog IS 'Compound inventory and inspectable calculations. Supplier exports are retained as source rows; existing search fingerprints are copied byte-for-byte, not recomputed.';

CREATE FUNCTION pyxis_catalog.fingerprint_popcount(value bytea)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN bit_count(value)::integer;

CREATE FUNCTION pyxis_catalog.fingerprint_bit_indexes(value bytea)
RETURNS integer[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(array_agg(byte_number * 8 + bit_number ORDER BY byte_number, bit_number), ARRAY[]::integer[])
  FROM generate_series(0, octet_length(value) - 1) AS bytes(byte_number)
  CROSS JOIN generate_series(0, 7) AS bits(bit_number)
  WHERE (get_byte(value, byte_number) & (1 << bit_number)) <> 0
$$;
COMMENT ON FUNCTION pyxis_catalog.fingerprint_bit_indexes(bytea) IS 'Zero-based set-bit indexes, ascending. Byte 0 contains bits 0..7 with the least-significant bit first, matching the existing macrocycle artifact.';

CREATE FUNCTION pyxis_catalog.fingerprint_frequencies(value bytea)
RETURNS integer[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(array_agg(get_byte(value, position) ORDER BY position), ARRAY[]::integer[])
  FROM generate_series(0, octet_length(value) - 1) AS positions(position)
$$;
COMMENT ON FUNCTION pyxis_catalog.fingerprint_frequencies(bytea) IS 'One unsigned frequency (1..255) per set bit, in the same ascending order as fingerprint_bit_indexes. These arrays are derived for inspection, not stored per molecule.';

CREATE TABLE pyxis_catalog.imports (
  source text PRIMARY KEY CHECK (source IN ('real', 'virtual')),
  collection_name text NOT NULL,
  source_file text NOT NULL,
  exported_at date NOT NULL,
  source_rows integer NOT NULL CHECK (source_rows >= 0),
  indexed_rows integer NOT NULL CHECK (indexed_rows >= 0),
  excluded_rows integer NOT NULL CHECK (excluded_rows >= 0),
  normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
  artifacts_sha256 jsonb NOT NULL CHECK (jsonb_typeof(artifacts_sha256) = 'object'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_rows = indexed_rows + excluded_rows)
);
COMMENT ON TABLE pyxis_catalog.imports IS 'One verified export per source. Full original normalized rows and byte-identical binary/count artifacts are imported atomically per source; hashes and original index manifest record provenance.';
COMMENT ON COLUMN pyxis_catalog.imports.excluded_rows IS 'Source rows retained in macrocycle_records but excluded from the existing search index; this is not a count of deleted records.';

CREATE TABLE pyxis_catalog.macrocycle_records (
  source text NOT NULL REFERENCES pyxis_catalog.imports(source),
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  index_row_id integer CHECK (index_row_id > 0),
  smiles text NOT NULL,
  source_id text,
  compound_code text,
  web_mg numeric,
  web_um numeric,
  current_tot_netto_mg numeric,
  current_tot_amount_um numeric,
  lead_time text,
  morgan_binary bytea,
  morgan_counts bytea,
  PRIMARY KEY (source, source_row_number),
  UNIQUE (source, index_row_id),
  CHECK (
    (index_row_id IS NULL AND morgan_binary IS NULL AND morgan_counts IS NULL)
    OR (index_row_id IS NOT NULL AND morgan_binary IS NOT NULL AND morgan_counts IS NOT NULL)
  ),
  CHECK (morgan_binary IS NULL OR octet_length(morgan_binary) = 256),
  CHECK (morgan_counts IS NULL OR octet_length(morgan_counts) = pyxis_catalog.fingerprint_popcount(morgan_binary)),
  CHECK (morgan_counts IS NULL OR position(decode('00', 'hex') IN morgan_counts) = 0)
);
CREATE INDEX macrocycle_records_compound_code_idx ON pyxis_catalog.macrocycle_records(source, compound_code);
CREATE INDEX macrocycle_records_source_id_idx ON pyxis_catalog.macrocycle_records(source, source_id);
COMMENT ON TABLE pyxis_catalog.macrocycle_records IS 'All normalized supplier rows, including rows excluded by the existing index. Supplier codes and structures may repeat within/across sources; never merge records solely by code or SMILES.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.source_row_number IS 'One-based data-row position in the normalized supplier export; excludes the CSV header and includes unsearchable rows.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.index_row_id IS 'One-based row ID in the existing macrocycle search index. NULL means retained source data with no index fingerprint. Identity requires source plus row ID.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.source_id IS 'Original supplier ID field, separate from MAIN_BAS compound code; this is not a globally unique identifier.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.compound_code IS 'Original MAIN_BAS supplier code (RPX or VPX). Codes can repeat, so this is not the primary key.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.smiles IS 'Original normalized-export SMILES. Presence in this table does not imply that RDKit accepted it for indexing.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.web_mg IS 'Supplier web_mg value from the dated export, in mg. Not a verified current offer.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.web_um IS 'Supplier web_uM field as supplied. Field name is preserved without reinterpreting its unit.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.current_tot_netto_mg IS 'Supplier CURRENT_TOT_NETTO_MG value, in mg, as of the export.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.current_tot_amount_um IS 'Supplier CURRENT_TOT_AMOUNT_UM value as supplied; no unit conversion is applied.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.lead_time IS 'Supplier Lead_TIME text, preserved without calculation or current-availability verification.';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.morgan_binary IS 'Exact 256-byte/2048-bit RDKit Morgan radius-2 artifact. Least-significant bit first within each byte. Not interchangeable with legacy stock mfp2 (512 bits).';
COMMENT ON COLUMN pyxis_catalog.macrocycle_records.morgan_counts IS 'Exact packed count artifact: one unsigned byte per binary set bit, in ascending bit order. Pyxis frequency-weighted Morgan environments, not MOE ctanimoto.';

CREATE VIEW pyxis_catalog.macrocycles AS
SELECT source, source_row_number, index_row_id, smiles, source_id, compound_code,
       web_mg, web_um, current_tot_netto_mg, current_tot_amount_um, lead_time,
       index_row_id IS NOT NULL AS searchable,
       pyxis_catalog.fingerprint_popcount(morgan_binary) AS morgan_set_bits,
       pyxis_catalog.fingerprint_bit_indexes(morgan_binary) AS morgan_bit_indexes,
       pyxis_catalog.fingerprint_frequencies(morgan_counts) AS morgan_frequencies
FROM pyxis_catalog.macrocycle_records;
CREATE VIEW pyxis_catalog.rpx AS SELECT * FROM pyxis_catalog.macrocycles WHERE source = 'real';
CREATE VIEW pyxis_catalog.vpx AS SELECT * FROM pyxis_catalog.macrocycles WHERE source = 'virtual';
COMMENT ON VIEW pyxis_catalog.macrocycles IS 'Combined RPX/VPX inspection view. Arrays pair by position: morgan_bit_indexes[i] has morgan_frequencies[i]. Source identities and duplicate structures remain distinct.';
COMMENT ON VIEW pyxis_catalog.rpx IS 'Real macrocycle supplier rows, including excluded rows; use searchable to identify existing indexed records.';
COMMENT ON VIEW pyxis_catalog.vpx IS 'Virtual macrocycle supplier rows, including excluded rows; use searchable to identify existing indexed records.';

CREATE FUNCTION pyxis_catalog.macrocycle_pair_scores(source_a text, row_a integer, source_b text, row_b integer)
RETURNS TABLE(binary_tanimoto double precision, count_tanimoto double precision, count_dice double precision)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
  a pyxis_catalog.macrocycle_records%ROWTYPE;
  b pyxis_catalog.macrocycle_records%ROWTYPE;
  bits_a integer[];
  bits_b integer[];
  intersection_count double precision;
  dot_product double precision;
  squared_a double precision;
  squared_b double precision;
  union_count double precision;
BEGIN
  SELECT * INTO a FROM pyxis_catalog.macrocycle_records
  WHERE source = source_a AND source_row_number = row_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Macrocycle source row not found: %/%', source_a, row_a USING ERRCODE = '22023'; END IF;
  SELECT * INTO b FROM pyxis_catalog.macrocycle_records
  WHERE source = source_b AND source_row_number = row_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'Macrocycle source row not found: %/%', source_b, row_b USING ERRCODE = '22023'; END IF;
  IF a.index_row_id IS NULL OR b.index_row_id IS NULL THEN
    RAISE EXCEPTION 'Cannot score an excluded source row: %/% or %/%', source_a, row_a, source_b, row_b USING ERRCODE = '22023';
  END IF;
  bits_a := pyxis_catalog.fingerprint_bit_indexes(a.morgan_binary);
  bits_b := pyxis_catalog.fingerprint_bit_indexes(b.morgan_binary);
  -- Sparse vectors only: join retained bit positions, not 2048-element dense arrays.
  SELECT count(*)::double precision,
         COALESCE(sum(get_byte(a.morgan_counts, ia - 1)::double precision * get_byte(b.morgan_counts, ib - 1)), 0)
    INTO intersection_count, dot_product
  FROM generate_subscripts(bits_a, 1) AS apos(ia)
  JOIN generate_subscripts(bits_b, 1) AS bpos(ib) ON bits_a[ia] = bits_b[ib];
  SELECT COALESCE(sum(get_byte(a.morgan_counts, i)::double precision ^ 2), 0) INTO squared_a
    FROM generate_series(0, octet_length(a.morgan_counts) - 1) AS positions(i);
  SELECT COALESCE(sum(get_byte(b.morgan_counts, i)::double precision ^ 2), 0) INTO squared_b
    FROM generate_series(0, octet_length(b.morgan_counts) - 1) AS positions(i);
  union_count := cardinality(bits_a) + cardinality(bits_b) - intersection_count;
  RETURN QUERY SELECT
    CASE WHEN union_count > 0 THEN intersection_count / union_count ELSE 0::double precision END,
    CASE WHEN squared_a + squared_b - dot_product > 0 THEN dot_product / (squared_a + squared_b - dot_product) ELSE 0::double precision END,
    CASE WHEN squared_a + squared_b > 0 THEN 2 * dot_product / (squared_a + squared_b) ELSE 0::double precision END;
END
$$;
COMMENT ON FUNCTION pyxis_catalog.macrocycle_pair_scores(text, integer, text, integer) IS 'Compare two stored macrocycle source rows (source_row_number, NOT index_row_id) using exact copied artifacts. Returns binary Tanimoto and Pyxis count Tanimoto/Dice; all zero denominators return 0. No chemical recomputation, cross-engine parity claim, or public search-route change.';

CREATE VIEW pyxis_catalog.stock AS
SELECT 'stock'::text AS source, m.id AS source_row_number, m.dataset_id,
       m.metadata ->> 'ID' AS source_id,
       m.metadata ->> 'MAIN_BAS' AS compound_code,
       m.smiles AS source_smiles, m.canonical_smiles AS smiles,
       m.metadata ->> 'web_mg' AS web_mg,
       m.metadata ->> 'web_uM' AS web_um,
       m.metadata ->> 'CURRENT_TOT_NETTO_MG' AS current_tot_netto_mg,
       m.metadata ->> 'CURRENT_TOT_AMOUNT_UM' AS current_tot_amount_um,
       m.metadata ->> 'Lead_TIME' AS lead_time,
       EXISTS (SELECT 1 FROM public.fingerprints f WHERE f.molecule_id = m.id) AS searchable,
       m.metadata
FROM public.molecules m
JOIN public.datasets d ON d.id = m.dataset_id
WHERE d.name = 'Stock compounds — 2026-09-01';
COMMENT ON VIEW pyxis_catalog.stock IS 'Existing stock inventory selected by exact dataset name. Metadata amount fields stay text to preserve missing/malformed supplier values. No writes, copies, fingerprint recalculation, or stock-search changes.';

CREATE VIEW pyxis_catalog.stock_fingerprints AS
SELECT m.id AS molecule_id, m.dataset_id,
       m.metadata ->> 'MAIN_BAS' AS compound_code,
       encode(bfp_to_binary_text(f.mfp2), 'hex') AS mfp2_hex,
       octet_length(bfp_to_binary_text(f.mfp2)) * 8 AS mfp2_bits,
       encode(bfp_to_binary_text(f.maccs), 'hex') AS maccs_hex,
       octet_length(bfp_to_binary_text(f.maccs)) * 8 AS maccs_storage_bits,
       encode(bfp_to_binary_text(f.ffp2), 'hex') AS ffp2_hex,
       octet_length(bfp_to_binary_text(f.ffp2)) * 8 AS ffp2_bits,
       encode(bfp_to_binary_text(f.apfp), 'hex') AS apfp_hex,
       octet_length(bfp_to_binary_text(f.apfp)) * 8 AS apfp_bits,
       encode(bfp_to_binary_text(f.ttfp), 'hex') AS ttfp_hex,
       octet_length(bfp_to_binary_text(f.ttfp)) * 8 AS ttfp_bits,
       encode(bfp_to_binary_text(f.rdfp), 'hex') AS rdfp_hex,
       octet_length(bfp_to_binary_text(f.rdfp)) * 8 AS rdfp_bits
FROM public.molecules m
JOIN public.datasets d ON d.id = m.dataset_id
JOIN public.fingerprints f ON f.molecule_id = m.id
WHERE d.name = 'Stock compounds — 2026-09-01';
COMMENT ON VIEW pyxis_catalog.stock_fingerprints IS 'Six existing stock fingerprint columns as readable hex plus actual byte-storage dimensions. Stock mfp2 and ffp2 are 512 bits; macrocycles use 2048. MACCS storage can include padding, so storage bits do not imply independent keys.';

CREATE VIEW pyxis_catalog.compounds AS
SELECT source, source_row_number::bigint AS source_row_number,
       source_id, compound_code, smiles, web_mg, web_um,
       current_tot_netto_mg, current_tot_amount_um, lead_time, searchable
FROM pyxis_catalog.stock
UNION ALL
SELECT source, source_row_number::bigint, source_id, compound_code, smiles,
       web_mg::text, web_um::text, current_tot_netto_mg::text, current_tot_amount_um::text,
       lead_time, index_row_id IS NOT NULL
FROM pyxis_catalog.macrocycle_records;
COMMENT ON VIEW pyxis_catalog.compounds IS 'Unified inventory of stock, RPX and VPX. Identity is source + source_row_number, never supplier code or SMILES. Amounts are textual for compatibility with legacy stock metadata. No deduplication or price/offer inference.';

CREATE VIEW pyxis_catalog.collections AS
SELECT i.source, i.collection_name, NULL::bigint AS legacy_dataset_id,
       i.source_file, i.exported_at, i.source_rows::bigint AS source_rows,
       i.indexed_rows::bigint AS indexed_rows, i.excluded_rows::bigint AS excluded_rows,
       'supplier export + copied search artifacts'::text AS storage_kind,
       i.imported_at, i.manifest
FROM pyxis_catalog.imports i
UNION ALL
SELECT CASE WHEN d.name = 'Stock compounds — 2026-09-01' THEN 'stock' ELSE 'legacy' END,
       CASE WHEN d.name = 'Stock compounds — 2026-09-01' THEN d.name ELSE 'Legacy: ' || d.name END,
       d.id::bigint, NULL::text, NULL::date, d.row_count::bigint,
       NULL::bigint, NULL::bigint, 'existing public schema'::text, NULL::timestamptz, NULL::jsonb
FROM public.datasets d;
COMMENT ON VIEW pyxis_catalog.collections IS 'Import manifests and existing dataset registry. Old datasets (including DATA) are explicitly labelled legacy. Legacy indexed/excluded counts are unknown here, not zero; row_count is the registry value.';

CREATE VIEW pyxis_catalog.calculation_methods AS
SELECT * FROM (VALUES
  ('stock', 'mfp2', 'binary', 'morganbv_fp(m.mol, 2)', '512 stored bits', 'RDKit cartridge Morgan radius 2, as inserted by the legacy importer. Settings/bit length differ from macrocycle Morgan; do not compare stored vectors across engines.'),
  ('stock', 'maccs', 'binary', 'maccs_fp(m.mol)', 'See stock_fingerprints.maccs_storage_bits', 'RDKit cartridge MACCS keys; storage padding is not extra chemical keys.'),
  ('stock', 'ffp2', 'binary', 'featmorganbv_fp(m.mol, 2)', '512 stored bits', 'RDKit cartridge Feature Morgan radius 2; binary, not a count vector.'),
  ('stock', 'apfp', 'binary', 'atompairbv_fp(m.mol)', 'See stock_fingerprints.apfp_bits', 'RDKit cartridge hashed atom-pair bit vector.'),
  ('stock', 'ttfp', 'binary', 'torsionbv_fp(m.mol)', 'See stock_fingerprints.ttfp_bits', 'RDKit cartridge topological-torsion bit vector.'),
  ('stock', 'rdfp', 'binary', 'rdkit_fp(m.mol)', 'See stock_fingerprints.rdfp_bits', 'RDKit cartridge path fingerprint.'),
  ('macrocycles', 'morgan_binary', 'binary', 'Existing artifact: RDKit Morgan radius 2, 2048 bits', '2048 stored bits', 'Copied byte-for-byte. SQL displays the existing calculation; it does not regenerate it with the PostgreSQL cartridge.'),
  ('macrocycles', 'morgan_counts', 'frequency-weighted', 'Pyxis countMorgan: retained Morgan environments per folded bit', 'One unsigned byte (1..255) per binary set bit', 'Count support equals binary support; ascending bit order. Pyxis method, not MOE ctanimoto. The existing builder excludes unsupported/isotope rows.'),
  ('stock and macrocycles', 'binary_tanimoto', 'query/pair calculation', 'intersection / (bitsA + bitsB - intersection)', '0..1; zero denominator gives 0', 'Compare vectors using the same fingerprint implementation and dimensions. Similarity is not a permanent molecule column.'),
  ('stock', 'binary_dice', 'query/pair calculation', '2 * intersection / (bitsA + bitsB)', '0..1; zero denominator gives 0', 'Stock supports binary metrics only; do not interpret bit-vector Dice as count Dice.'),
  ('macrocycles', 'count_tanimoto', 'query/pair calculation', 'dot(x,y) / (sum(x*x) + sum(y*y) - dot(x,y))', '0..1; zero denominator gives 0', 'Frequency-weighted Pyxis Morgan; not MOE ctanimoto or MOE-comparable.'),
  ('macrocycles', 'count_dice', 'query/pair calculation', '2 * dot(x,y) / (sum(x*x) + sum(y*y))', '0..1; zero denominator gives 0', 'Frequency-weighted Pyxis Morgan. macrocycle_pair_scores accepts original source row numbers.')
) AS methods(collection, field_or_metric, representation, calculation, dimensions_or_range, notes);
COMMENT ON VIEW pyxis_catalog.calculation_methods IS 'Inspectable method dictionary: legacy stock insertion functions, copied macrocycle vector provenance, exact metric formulas, and comparability limits.';

CREATE VIEW pyxis_catalog.data_dictionary AS
SELECT * FROM (VALUES
  ('macrocycle_records', 'source + source_row_number', 'Identity', 'real = RPX; virtual = VPX. One-based normalized source data row; retained even if indexing failed.'),
  ('macrocycle_records', 'index_row_id', 'Existing search identity', 'Index row number within source; NULL means not searchable. Different from source_row_number after an excluded row.'),
  ('macrocycle_records', 'source_id', 'Imported: ID', 'Supplier identifier, retained as text and not assumed unique.'),
  ('macrocycle_records', 'compound_code', 'Imported: MAIN_BAS', 'RPX/VPX compound code; duplicates retained. Source and row number remain the primary key.'),
  ('macrocycle_records', 'smiles', 'Imported: smiles', 'Source chemical structure text, including rows the original index could not accept.'),
  ('macrocycle_records', 'web_mg', 'Imported: web_mg', 'Supplier amount in mg; dated snapshot, not live stock confirmation.'),
  ('macrocycle_records', 'web_um', 'Imported: web_uM', 'Supplier field retained without recalculation or unit reinterpretation.'),
  ('macrocycle_records', 'current_tot_netto_mg', 'Imported: CURRENT_TOT_NETTO_MG', 'Supplier total in mg from the export.'),
  ('macrocycle_records', 'current_tot_amount_um', 'Imported: CURRENT_TOT_AMOUNT_UM', 'Supplier total field retained without recalculation or unit reinterpretation.'),
  ('macrocycle_records', 'lead_time', 'Imported: Lead_TIME', 'Supplier text from the export, not a calculated or verified delivery promise.'),
  ('macrocycles', 'morgan_bit_indexes + morgan_frequencies', 'Derived view of stored bytes', 'Matching arrays by position: bit indexes are zero-based; frequencies are positive environment counts. These are not MOE feature lists.'),
  ('stock', 'source_row_number', 'Existing: public.molecules.id', 'Existing stock molecule primary key. Together with source, forms the unified inventory identity.'),
  ('stock', 'amount fields', 'Existing: public.molecules.metadata', 'Text preserved without unsafe numeric casts; missing keys return NULL.'),
  ('imports', 'manifest + hashes', 'Import provenance', 'Original index manifest and file SHA-256 hashes. Source/index/exclusion totals can be reconciled without losing invalid source rows.'),
  ('compounds', 'prices', 'Not stored here', 'No price column is inferred from inventory quantities. Workbook pricing/currency display belongs to the application pricing code and is not a verified purchase offer.'),
  ('calculation_methods', 'similarity metrics', 'Calculated for a query or pair', 'A molecule has no query-independent similarity score. Use macrocycle_pair_scores for two stored macrocycle source rows.')
) AS dictionary(relation_name, field_name, origin, meaning);
COMMENT ON VIEW pyxis_catalog.data_dictionary IS 'Human-readable guide to imported fields, derived views, identifiers, missing values and calculation scope. Browse this and calculation_methods before interpreting columns.';
