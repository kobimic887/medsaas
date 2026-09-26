-- Run AFTER schema.sql, inside a transaction that is always rolled back.
INSERT INTO pyxis_catalog.imports
 (source,collection_name,source_file,exported_at,source_rows,indexed_rows,excluded_rows,normalized_sha256,artifacts_sha256,manifest)
VALUES ('real','SQL test fixture','fixture.csv','2026-01-01',3,2,1,repeat('a',64),'{}','{}');

INSERT INTO pyxis_catalog.macrocycle_records
 (source,source_row_number,index_row_id,smiles,source_id,compound_code,morgan_binary,morgan_counts)
VALUES
 ('real',1,1,'CCO','same','RPX duplicate',decode('03'||repeat('00',255),'hex'),decode('0203','hex')),
 ('real',2,NULL,'invalid','excluded','RPX invalid',NULL,NULL),
 ('real',3,2,'CCN','same','RPX duplicate',decode('05'||repeat('00',255),'hex'),decode('0405','hex'));

DO $$
DECLARE s record;
BEGIN
 IF (SELECT count(*) FROM pyxis_catalog.rpx) <> 3 THEN RAISE EXCEPTION 'Original rows lost'; END IF;
 IF (SELECT count(*) FROM pyxis_catalog.rpx WHERE searchable) <> 2 THEN RAISE EXCEPTION 'Excluded row marked searchable'; END IF;
 IF (SELECT morgan_bit_indexes FROM pyxis_catalog.rpx WHERE source_row_number=1) <> ARRAY[0,1] THEN RAISE EXCEPTION 'Bit order incorrect'; END IF;
 IF (SELECT morgan_frequencies FROM pyxis_catalog.rpx WHERE source_row_number=1) <> ARRAY[2,3] THEN RAISE EXCEPTION 'Count order incorrect'; END IF;
 SELECT * INTO s FROM pyxis_catalog.macrocycle_pair_scores('real',1,'real',3);
 IF abs(s.binary_tanimoto-1.0/3) > 1e-12 OR abs(s.count_tanimoto-8.0/46) > 1e-12 OR abs(s.count_dice-16.0/54) > 1e-12 THEN
   RAISE EXCEPTION 'Pair score arithmetic incorrect: %', s;
 END IF;
 SELECT * INTO s FROM pyxis_catalog.macrocycle_pair_scores('real',3,'real',3);
 IF s.binary_tanimoto <> 1 OR s.count_tanimoto <> 1 OR s.count_dice <> 1 THEN RAISE EXCEPTION 'Self-match incorrect'; END IF;
 BEGIN
  PERFORM * FROM pyxis_catalog.macrocycle_pair_scores('real',2,'real',3);
  RAISE EXCEPTION 'Excluded structure accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  INSERT INTO pyxis_catalog.macrocycle_records
   (source,source_row_number,index_row_id,smiles,morgan_binary,morgan_counts)
  VALUES ('real',4,3,'CC',decode('03'||repeat('00',255),'hex'),decode('02','hex'));
  RAISE EXCEPTION 'Bad vector pair accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
SELECT 'SQL fixture passed: source rows, duplicates, excluded rows, vector decoding and score formulas' AS verification;
