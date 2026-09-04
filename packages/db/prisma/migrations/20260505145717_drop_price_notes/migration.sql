/*
  Warnings:

  - You are about to drop the column `priceNotes` on the `collection_layout_rows` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "collection_catalog_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "collection_layout_rows" DROP COLUMN "priceNotes";

-- AlterTable
ALTER TABLE "collection_row_quotations" ALTER COLUMN "updatedAt" DROP DEFAULT;
