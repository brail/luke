/*
  Warnings:

  - Made the column `countryCode` on table `pricing_parameter_sets` required. This step will fail if there are existing NULL values in that column.

*/
-- Imposta 'XX' (paese sconosciuto) sui record esistenti senza countryCode
UPDATE "pricing_parameter_sets" SET "countryCode" = 'XX' WHERE "countryCode" IS NULL;

-- AlterTable
ALTER TABLE "pricing_parameter_sets" ALTER COLUMN "countryCode" SET NOT NULL;
