-- AlterTable: add skuBudget to collection_groups
ALTER TABLE "collection_groups" ADD COLUMN "skuBudget" INTEGER;

-- AlterTable: add skuBudget and hiddenColumns to collection_layouts
ALTER TABLE "collection_layouts" ADD COLUMN "skuBudget" INTEGER;
ALTER TABLE "collection_layouts" ADD COLUMN "hiddenColumns" TEXT;
