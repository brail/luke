/*
  Warnings:

  - You are about to drop the column `readOnly` on the `calendar_event_visibilities` table. All the data in the column will be lost.
  - You are about to drop the column `ownerFunctionId` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `calendar_events` table. All the data in the column will be lost.
  - You are about to drop the column `ownerFunctionId` on the `milestone_template_items` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `milestone_template_items` table. All the data in the column will be lost.
  - You are about to drop the `calendar_catalog_items` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_ownerFunctionId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_template_items" DROP CONSTRAINT "milestone_template_items_ownerFunctionId_fkey";

-- DropIndex
DROP INDEX "calendar_events_ownerFunctionId_idx";

-- DropIndex
DROP INDEX "milestone_template_items_ownerFunctionId_idx";

-- AlterTable
ALTER TABLE "calendar_event_visibilities" DROP COLUMN "readOnly";

-- AlterTable
ALTER TABLE "calendar_events" DROP COLUMN "ownerFunctionId",
DROP COLUMN "type";

-- AlterTable
ALTER TABLE "milestone_template_items" DROP COLUMN "ownerFunctionId",
DROP COLUMN "type";

-- DropTable
DROP TABLE "calendar_catalog_items";
