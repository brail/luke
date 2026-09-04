/*
  Warnings:

  - The primary key for the `nav_kimo_sales_line` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `lineNo` on the `nav_kimo_sales_line` table. All the data in the column will be lost.
  - You are about to drop the `nav_kimo_assortimenti` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `entryNo` to the `nav_kimo_sales_line` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "nav_kimo_sales_header" ADD COLUMN     "sellingSeasonCode" TEXT;

-- AlterTable
ALTER TABLE "nav_kimo_sales_line" DROP CONSTRAINT "nav_kimo_sales_line_pkey",
DROP COLUMN "lineNo",
ADD COLUMN     "entryNo" BIGINT NOT NULL,
ADD CONSTRAINT "nav_kimo_sales_line_pkey" PRIMARY KEY ("entryNo");

-- DropTable
DROP TABLE "public"."nav_kimo_assortimenti";

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_sellingSeasonCode_idx" ON "nav_kimo_sales_header"("sellingSeasonCode");

-- CreateIndex
CREATE INDEX "nav_kimo_sales_header_trademarkCode_sellingSeasonCode_idx" ON "nav_kimo_sales_header"("trademarkCode", "sellingSeasonCode");
