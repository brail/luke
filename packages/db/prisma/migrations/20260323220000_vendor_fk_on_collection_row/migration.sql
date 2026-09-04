-- Sostituisce il campo supplier (testo libero) con navVendorId (FK a nav_vendors)
-- Le righe esistenti perdono il valore supplier — accettabile in ambiente di sviluppo.

ALTER TABLE "collection_layout_rows" DROP COLUMN "supplier";

ALTER TABLE "collection_layout_rows"
  ADD COLUMN "navVendorId" TEXT,
  ADD CONSTRAINT "collection_layout_rows_navVendorId_fkey"
    FOREIGN KEY ("navVendorId") REFERENCES "nav_vendors"("navNo")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "collection_layout_rows_navVendorId_idx" ON "collection_layout_rows"("navVendorId");
