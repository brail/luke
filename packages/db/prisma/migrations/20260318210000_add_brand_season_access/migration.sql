-- CreateTable: user_brand_access
-- Whitelist brand per utente (empty = tutti i brand accessibili)
CREATE TABLE "user_brand_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "user_brand_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_season_access
-- Whitelist stagioni per utente+brand (empty per brand = tutte le stagioni accessibili)
CREATE TABLE "user_season_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,

    CONSTRAINT "user_season_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_brand_access_userId_idx" ON "user_brand_access"("userId");
CREATE UNIQUE INDEX "user_brand_access_userId_brandId_key" ON "user_brand_access"("userId", "brandId");

CREATE INDEX "user_season_access_userId_brandId_idx" ON "user_season_access"("userId", "brandId");
CREATE UNIQUE INDEX "user_season_access_userId_brandId_seasonId_key" ON "user_season_access"("userId", "brandId", "seasonId");

-- AddForeignKey
ALTER TABLE "user_brand_access" ADD CONSTRAINT "user_brand_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_brand_access" ADD CONSTRAINT "user_brand_access_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_season_access" ADD CONSTRAINT "user_season_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_season_access" ADD CONSTRAINT "user_season_access_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_season_access" ADD CONSTRAINT "user_season_access_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
