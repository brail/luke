-- Introduce anagrafica interna Vendor (B' architecture):
-- entità standalone con collegamento opzionale a NAV.
--
-- Steps:
--   1. Crea tabella vendors
--   2. Popola vendors dalle righe nav_vendors già presenti in collection_layout_rows
--      (ogni navVendorId distinto diventa un Vendor con navVendorId → NavVendor)
--   3. Aggiunge vendorId a collection_layout_rows
--   4. Aggiorna vendorId puntando al Vendor appena creato
--   5. Rimuove il vecchio navVendorId da collection_layout_rows

-- 1. Tabella vendors
CREATE TABLE "vendors" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "nickname"    TEXT,
  "referente"   TEXT,
  "email"       TEXT,
  "phone"       TEXT,
  "chat"        TEXT,
  "notes"       TEXT,
  "navVendorId" TEXT UNIQUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vendors_name_idx" ON "vendors"("name");

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_navVendorId_fkey"
    FOREIGN KEY ("navVendorId") REFERENCES "nav_vendors"("navNo")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Popola vendors dalla JOIN con nav_vendors (solo navVendorId distinti usati in collection_layout_rows)
INSERT INTO "vendors" ("id", "name", "navVendorId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  nv."name",
  nv."navNo",
  NOW(),
  NOW()
FROM "nav_vendors" nv
WHERE nv."navNo" IN (
  SELECT DISTINCT "navVendorId"
  FROM "collection_layout_rows"
  WHERE "navVendorId" IS NOT NULL
);

-- 3. Aggiunge vendorId a collection_layout_rows
ALTER TABLE "collection_layout_rows"
  ADD COLUMN "vendorId" TEXT;

ALTER TABLE "collection_layout_rows"
  ADD CONSTRAINT "collection_layout_rows_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "collection_layout_rows_vendorId_idx" ON "collection_layout_rows"("vendorId");

-- 4. Aggiorna vendorId puntando al Vendor corrispondente al vecchio navVendorId
UPDATE "collection_layout_rows" clr
SET "vendorId" = v."id"
FROM "vendors" v
WHERE clr."navVendorId" = v."navVendorId";

-- 5. Rimuove il vecchio navVendorId da collection_layout_rows
ALTER TABLE "collection_layout_rows"
  DROP CONSTRAINT IF EXISTS "collection_layout_rows_navVendorId_fkey";

DROP INDEX IF EXISTS "collection_layout_rows_navVendorId_idx";

ALTER TABLE "collection_layout_rows"
  DROP COLUMN "navVendorId";
