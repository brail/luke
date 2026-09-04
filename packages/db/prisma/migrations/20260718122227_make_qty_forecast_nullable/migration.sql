-- AlterTable
ALTER TABLE "collection_layout_row_revisions" ALTER COLUMN "qtyForecast" DROP NOT NULL;

-- AlterTable
ALTER TABLE "collection_layout_rows" ALTER COLUMN "qtyForecast" DROP NOT NULL;
