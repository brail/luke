-- Soft delete per Vendor: aggiunge isActive (default true).
-- Il delete fisico viene sostituito da isActive = false.
-- Il sync NAV non tocca mai isActive.

ALTER TABLE "vendors" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "vendors_isActive_idx" ON "vendors"("isActive");
