/*
  Warnings:

  - You are about to drop the column `expectedMinPhaseId` on the `collection_catalog_items` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "collection_catalog_items" DROP CONSTRAINT "collection_catalog_items_expectedMinPhaseId_fkey";

-- DropIndex
DROP INDEX "collection_catalog_items_expectedMinPhaseId_idx";

-- AlterTable
ALTER TABLE "collection_catalog_items" DROP COLUMN "expectedMinPhaseId";
