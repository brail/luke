/*
  Warnings:

  - You are about to drop the `user_season_access` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."user_season_access" DROP CONSTRAINT "user_season_access_brandId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_season_access" DROP CONSTRAINT "user_season_access_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_season_access" DROP CONSTRAINT "user_season_access_userId_fkey";

-- DropTable
DROP TABLE "public"."user_season_access";
