/*
  Warnings:

  - You are about to drop the column `buyingTargetPrice` on the `collection_layout_rows` table. All the data in the column will be lost.
  - You are about to drop the column `pricingParameterSetId` on the `collection_layout_rows` table. All the data in the column will be lost.
  - You are about to drop the column `retailTargetPrice` on the `collection_layout_rows` table. All the data in the column will be lost.
  - You are about to drop the column `supplierFirstQuotation` on the `collection_layout_rows` table. All the data in the column will be lost.

*/

-- Step 1: Create new tables first (needed for data migration below)

-- CreateTable
CREATE TABLE "collection_row_quotations" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "pricingParameterSetId" TEXT,
    "retailPrice" DOUBLE PRECISION,
    "supplierQuotation" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_row_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_catalog_items" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_row_quotations_rowId_idx" ON "collection_row_quotations"("rowId");
CREATE INDEX "collection_row_quotations_pricingParameterSetId_idx" ON "collection_row_quotations"("pricingParameterSetId");
CREATE INDEX "collection_catalog_items_type_isActive_idx" ON "collection_catalog_items"("type", "isActive");
CREATE UNIQUE INDEX "collection_catalog_items_type_value_key" ON "collection_catalog_items"("type", "value");

-- Step 2: Data migration — migrate existing single-quotation data to collection_row_quotations
INSERT INTO "collection_row_quotations" ("id", "rowId", "order", "pricingParameterSetId", "retailPrice", "supplierQuotation", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::TEXT,
  r."id",
  0,
  r."pricingParameterSetId",
  r."retailTargetPrice",
  r."supplierFirstQuotation",
  NOW(),
  NOW()
FROM "collection_layout_rows" r
WHERE r."supplierFirstQuotation" IS NOT NULL
   OR r."retailTargetPrice" IS NOT NULL
   OR r."pricingParameterSetId" IS NOT NULL;

-- Step 3: Seed catalog items with default values

-- Strategy
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "order", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::TEXT, 'strategy', 'CORE',       'Core',       0, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'strategy', 'INNOVATION', 'Innovation', 1, true, NOW(), NOW());

-- Line Status
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "order", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::TEXT, 'lineStatus', 'CARRY_OVER', 'Carry Over', 0, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'lineStatus', 'NEW',        'New',        1, true, NOW(), NOW());

-- Style Status
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "order", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::TEXT, 'styleStatus', 'CARRY_OVER', 'Carry Over', 0, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'styleStatus', 'NEW',        'New',        1, true, NOW(), NOW());

-- Progress
INSERT INTO "collection_catalog_items" ("id", "type", "value", "label", "order", "isActive", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::TEXT, 'progress', '01 - FASE DI DESIGN',    '01 - Fase di Design',    0, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'progress', '02 - COSTRUZIONE OK',    '02 - Costruzione OK',    1, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'progress', '03 - MODELLERIA OK',     '03 - Modelleria OK',     2, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'progress', '04 - RENDERING FATTI',   '04 - Rendering Fatti',   3, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'progress', '05 - SPEC SHEETS PRONTE','05 - Spec Sheets Pronte',4, true, NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'progress', '06 - SMS LANCIATI',      '06 - SMS Lanciati',      5, true, NOW(), NOW());

-- Step 4: Add FK constraints for collection_row_quotations
ALTER TABLE "collection_row_quotations" ADD CONSTRAINT "collection_row_quotations_rowId_fkey"
  FOREIGN KEY ("rowId") REFERENCES "collection_layout_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_row_quotations" ADD CONSTRAINT "collection_row_quotations_pricingParameterSetId_fkey"
  FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 5: Drop old pricing columns and FK
ALTER TABLE "public"."collection_layout_rows" DROP CONSTRAINT "collection_layout_rows_pricingParameterSetId_fkey";
DROP INDEX "public"."collection_layout_rows_pricingParameterSetId_idx";

ALTER TABLE "collection_layout_rows"
  DROP COLUMN "buyingTargetPrice",
  DROP COLUMN "pricingParameterSetId",
  DROP COLUMN "retailTargetPrice",
  DROP COLUMN "supplierFirstQuotation",
  ADD COLUMN "article" TEXT;

-- Step 6: Add availableGenders to collection_layouts
ALTER TABLE "collection_layouts" ADD COLUMN "availableGenders" TEXT[] DEFAULT ARRAY['MAN', 'WOMAN']::TEXT[];
