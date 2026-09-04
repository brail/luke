/*
  Warnings:

  - You are about to drop the column `expectedMinProgress` on the `collection_catalog_items` table.
  - You are about to drop the column `progress` on the `collection_layout_rows` table.
  - You are about to drop the `collection_catalog_items` rows where type='progress'.

  Data migration (cutover, no intermediate dual-field period — see docs/genoma-collezione-pianificazione.md):
  1. Create the `phases` table.
  2. Seed it dynamically from whatever `collection_catalog_items` rows of type='progress' exist in
     THIS environment (not the 6 hardcoded defaults), preserving value/label/code/order/isActive —
     so any tenant-specific customization already made at runtime is not lost.
  3. Backfill `collection_layout_rows.phaseId` and `collection_catalog_items.expectedMinPhaseId`
     by resolving the old string value against the newly seeded `phases.value`.
  4. Assert row counts match before dropping the old columns — abort the migration instead of
     silently losing state if any row fails to resolve.
  5. Drop the old `progress`/`expectedMinProgress` columns and the now-redundant
     `collection_catalog_items` type='progress' rows.
*/

-- CreateTable
CREATE TABLE "phases" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phases_value_key" ON "phases"("value");

-- CreateIndex
CREATE INDEX "phases_isActive_idx" ON "phases"("isActive");

-- Seed phases dynamically from the live progress catalog (whatever exists today, not hardcoded defaults)
INSERT INTO "phases" ("id", "value", "label", "code", "order", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "value", "label", "code", "order", "isActive", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "collection_catalog_items"
WHERE "type" = 'progress';

-- AlterTable: add nullable phaseId columns (no FK yet — added after backfill)
ALTER TABLE "collection_layout_rows" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "collection_catalog_items" ADD COLUMN "expectedMinPhaseId" TEXT;
ALTER TABLE "calendar_events" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "milestone_template_items" ADD COLUMN "phaseId" TEXT;

-- Backfill collection_layout_rows.phaseId by resolving the old progress string value
UPDATE "collection_layout_rows" r
SET "phaseId" = p."id"
FROM "phases" p
WHERE r."progress" IS NOT NULL AND r."progress" = p."value";

-- Backfill collection_catalog_items.expectedMinPhaseId by resolving the old expectedMinProgress value
UPDATE "collection_catalog_items" c
SET "expectedMinPhaseId" = p."id"
FROM "phases" p
WHERE c."expectedMinProgress" IS NOT NULL AND c."expectedMinProgress" = p."value";

-- Safety check: abort instead of silently dropping state if any row failed to resolve
DO $$
DECLARE
  unresolved_rows INTEGER;
  unresolved_catalog INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_rows
  FROM "collection_layout_rows"
  WHERE "progress" IS NOT NULL AND "phaseId" IS NULL;

  SELECT COUNT(*) INTO unresolved_catalog
  FROM "collection_catalog_items"
  WHERE "expectedMinProgress" IS NOT NULL AND "expectedMinPhaseId" IS NULL;

  IF unresolved_rows > 0 THEN
    RAISE EXCEPTION 'unify_phase_catalog: % collection_layout_rows have a progress value with no matching Phase — aborting to avoid silent data loss', unresolved_rows;
  END IF;

  IF unresolved_catalog > 0 THEN
    RAISE EXCEPTION 'unify_phase_catalog: % collection_catalog_items have an expectedMinProgress value with no matching Phase — aborting to avoid silent data loss', unresolved_catalog;
  END IF;
END $$;

-- Drop the old string columns now that phaseId/expectedMinPhaseId are fully backfilled
ALTER TABLE "collection_layout_rows" DROP COLUMN "progress";
ALTER TABLE "collection_catalog_items" DROP COLUMN "expectedMinProgress";

-- Remove the now-redundant progress rows from the old catalog (superseded by the phases table)
DELETE FROM "collection_catalog_items" WHERE "type" = 'progress';

-- CreateIndex
CREATE INDEX "calendar_events_phaseId_idx" ON "calendar_events"("phaseId");

-- CreateIndex
CREATE INDEX "collection_catalog_items_expectedMinPhaseId_idx" ON "collection_catalog_items"("expectedMinPhaseId");

-- CreateIndex
CREATE INDEX "collection_layout_rows_phaseId_idx" ON "collection_layout_rows"("phaseId");

-- CreateIndex
CREATE INDEX "milestone_template_items_phaseId_idx" ON "milestone_template_items"("phaseId");

-- AddForeignKey
ALTER TABLE "collection_layout_rows" ADD CONSTRAINT "collection_layout_rows_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_catalog_items" ADD CONSTRAINT "collection_catalog_items_expectedMinPhaseId_fkey" FOREIGN KEY ("expectedMinPhaseId") REFERENCES "phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_items" ADD CONSTRAINT "milestone_template_items_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
