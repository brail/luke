-- DropIndex
DROP INDEX "public"."seasons_code_idx";

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "collection_layout_rows_pricingParameterSetId_idx" ON "collection_layout_rows"("pricingParameterSetId");
