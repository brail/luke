-- Aggiunge tabelle NAV replica per Brand e Season
-- e collega le entità locali tramite FK opzionale (stesso pattern Vendor)

-- CreateTable nav_brands
CREATE TABLE "nav_brands" (
    "navCode"     TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "syncedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_brands_pkey" PRIMARY KEY ("navCode")
);

-- CreateTable nav_seasons
CREATE TABLE "nav_seasons" (
    "navCode"      TEXT NOT NULL,
    "description"  TEXT NOT NULL DEFAULT '',
    "startingDate" TIMESTAMP(3),
    "endingDate"   TIMESTAMP(3),
    "syncedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_seasons_pkey" PRIMARY KEY ("navCode")
);

-- Indici su description per ricerca
CREATE INDEX "nav_brands_description_idx"  ON "nav_brands"("description");
CREATE INDEX "nav_seasons_description_idx" ON "nav_seasons"("description");

-- AlterTable brands: aggiungi navBrandId
ALTER TABLE "brands" ADD COLUMN "navBrandId" TEXT;
CREATE UNIQUE INDEX "brands_navBrandId_key" ON "brands"("navBrandId");
ALTER TABLE "brands" ADD CONSTRAINT "brands_navBrandId_fkey"
    FOREIGN KEY ("navBrandId") REFERENCES "nav_brands"("navCode")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable seasons: aggiungi navSeasonId, rendi year nullable, cambia unique da (code,year) a code solo
DROP INDEX IF EXISTS "seasons_code_year_key";
DROP INDEX IF EXISTS "seasons_code_year_idx";
ALTER TABLE "seasons" ALTER COLUMN "year" DROP NOT NULL;
ALTER TABLE "seasons" ADD COLUMN "navSeasonId" TEXT;
CREATE UNIQUE INDEX "seasons_code_key"      ON "seasons"("code");
CREATE UNIQUE INDEX "seasons_navSeasonId_key" ON "seasons"("navSeasonId");
CREATE INDEX "seasons_code_idx" ON "seasons"("code");
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_navSeasonId_fkey"
    FOREIGN KEY ("navSeasonId") REFERENCES "nav_seasons"("navCode")
    ON DELETE SET NULL ON UPDATE CASCADE;
