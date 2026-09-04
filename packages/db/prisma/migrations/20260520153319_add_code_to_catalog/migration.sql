-- AlterTable: add code column to collection_catalog_items
ALTER TABLE "collection_catalog_items" ADD COLUMN "code" TEXT;

-- DataMigration: refactor progress catalog values (separate code from value/label)
-- Mapping: "01 - FASE DI DESIGN" → value=DESIGN, code=01, label=Fase di Design, etc.
UPDATE "collection_catalog_items" SET
  code  = CASE value
    WHEN '01 - FASE DI DESIGN'     THEN '01'
    WHEN '02 - COSTRUZIONE OK'     THEN '02'
    WHEN '03 - MODELLERIA OK'      THEN '03'
    WHEN '04 - RENDERING FATTI'    THEN '04'
    WHEN '05 - SPEC SHEETS PRONTE' THEN '05'
    WHEN '06 - SMS LANCIATI'       THEN '06'
    ELSE code
  END,
  label = CASE value
    WHEN '01 - FASE DI DESIGN'     THEN 'Fase di Design'
    WHEN '02 - COSTRUZIONE OK'     THEN 'Costruzione OK'
    WHEN '03 - MODELLERIA OK'      THEN 'Modelleria OK'
    WHEN '04 - RENDERING FATTI'    THEN 'Rendering Fatti'
    WHEN '05 - SPEC SHEETS PRONTE' THEN 'Spec Sheets Pronte'
    WHEN '06 - SMS LANCIATI'       THEN 'SMS Lanciati'
    ELSE label
  END,
  value = CASE value
    WHEN '01 - FASE DI DESIGN'     THEN 'DESIGN'
    WHEN '02 - COSTRUZIONE OK'     THEN 'CONSTRUCTION_OK'
    WHEN '03 - MODELLERIA OK'      THEN 'MODELLERIA_OK'
    WHEN '04 - RENDERING FATTI'    THEN 'RENDERING'
    WHEN '05 - SPEC SHEETS PRONTE' THEN 'SPECSHEETS_READY'
    WHEN '06 - SMS LANCIATI'       THEN 'SMS_LAUNCHED'
    ELSE value
  END
WHERE type = 'progress';

-- DataMigration: cascade progress values to collection_layout_rows
UPDATE "collection_layout_rows" SET progress = CASE progress
  WHEN '01 - FASE DI DESIGN'     THEN 'DESIGN'
  WHEN '02 - COSTRUZIONE OK'     THEN 'CONSTRUCTION_OK'
  WHEN '03 - MODELLERIA OK'      THEN 'MODELLERIA_OK'
  WHEN '04 - RENDERING FATTI'    THEN 'RENDERING'
  WHEN '05 - SPEC SHEETS PRONTE' THEN 'SPECSHEETS_READY'
  WHEN '06 - SMS LANCIATI'       THEN 'SMS_LAUNCHED'
  ELSE progress
END
WHERE progress IN (
  '01 - FASE DI DESIGN',
  '02 - COSTRUZIONE OK',
  '03 - MODELLERIA OK',
  '04 - RENDERING FATTI',
  '05 - SPEC SHEETS PRONTE',
  '06 - SMS LANCIATI'
);
