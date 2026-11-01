-- #130: the database refuses deleting a parameter set in use, by any path. No row changes.
-- DropForeignKey
ALTER TABLE "collection_row_quotations" DROP CONSTRAINT "collection_row_quotations_pricingParameterSetId_fkey";

-- DropForeignKey
ALTER TABLE "merchandising_plan_rows" DROP CONSTRAINT "merchandising_plan_rows_pricingParameterSetId_fkey";

-- AddForeignKey
ALTER TABLE "collection_row_quotations" ADD CONSTRAINT "collection_row_quotations_pricingParameterSetId_fkey" FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandising_plan_rows" ADD CONSTRAINT "merchandising_plan_rows_pricingParameterSetId_fkey" FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

