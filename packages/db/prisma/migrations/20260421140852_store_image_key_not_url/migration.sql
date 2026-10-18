/*
  Warnings:

  - You are about to drop the column `logoUrl` on the `brands` table. All the data in the column will be lost.
  - You are about to drop the column `pictureUrl` on the `collection_layout_rows` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `merchandising_images` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "brands" DROP COLUMN "logoUrl",
ADD COLUMN     "logoKey" TEXT;

-- AlterTable
ALTER TABLE "collection_layout_rows" DROP COLUMN "pictureUrl",
ADD COLUMN     "pictureKey" TEXT;

-- AlterTable
ALTER TABLE "merchandising_images" DROP COLUMN "url",
ADD COLUMN     "key" TEXT;
