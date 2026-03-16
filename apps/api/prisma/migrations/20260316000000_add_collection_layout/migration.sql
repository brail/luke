-- CreateTable
CREATE TABLE "pricing_parameter_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchaseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "sellingCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "qualityControlPercent" REAL NOT NULL,
    "transportInsuranceCost" REAL NOT NULL,
    "duty" REAL NOT NULL,
    "exchangeRate" REAL NOT NULL,
    "italyAccessoryCosts" REAL NOT NULL,
    "tools" REAL NOT NULL,
    "retailMultiplier" REAL NOT NULL,
    "optimalMargin" REAL NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pricing_parameter_sets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pricing_parameter_sets_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_layouts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "collection_layouts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "collection_layouts_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionLayoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "collection_groups_collectionLayoutId_fkey" FOREIGN KEY ("collectionLayoutId") REFERENCES "collection_layouts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_layout_rows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionLayoutId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "gender" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skuForecast" INTEGER NOT NULL,
    "qtyForecast" INTEGER NOT NULL,
    "productCategory" TEXT NOT NULL,
    "strategy" TEXT,
    "styleStatus" TEXT,
    "progress" TEXT,
    "designer" TEXT,
    "pictureUrl" TEXT,
    "styleNotes" TEXT,
    "materialNotes" TEXT,
    "colorNotes" TEXT,
    "priceNotes" TEXT,
    "toolingNotes" TEXT,
    "dutyCategory" TEXT,
    "pricingParameterSetId" TEXT,
    "retailTargetPrice" REAL,
    "buyingTargetPrice" REAL,
    "supplierFirstQuotation" REAL,
    "toolingQuotation" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "collection_layout_rows_collectionLayoutId_fkey" FOREIGN KEY ("collectionLayoutId") REFERENCES "collection_layouts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_layout_rows_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "collection_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_layout_rows_pricingParameterSetId_fkey" FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_permission_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT,
    "oldRole" TEXT,
    "newRole" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "permission_audits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_permission_audits" ("action", "actorId", "createdAt", "id", "newRole", "oldRole", "permission", "reason", "userId") SELECT "action", "actorId", "createdAt", "id", "newRole", "oldRole", "permission", "reason", "userId" FROM "permission_audits";
DROP TABLE "permission_audits";
ALTER TABLE "new_permission_audits" RENAME TO "permission_audits";
CREATE INDEX "permission_audits_action_createdAt_idx" ON "permission_audits"("action", "createdAt");
CREATE INDEX "permission_audits_userId_idx" ON "permission_audits"("userId");
CREATE INDEX "permission_audits_actorId_idx" ON "permission_audits"("actorId");
CREATE TABLE "new_user_granted_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT,
    "reason" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_granted_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_granted_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_user_granted_permissions" ("createdAt", "expiresAt", "grantedBy", "id", "permission", "reason", "updatedAt", "userId") SELECT "createdAt", "expiresAt", "grantedBy", "id", "permission", "reason", "updatedAt", "userId" FROM "user_granted_permissions";
DROP TABLE "user_granted_permissions";
ALTER TABLE "new_user_granted_permissions" RENAME TO "user_granted_permissions";
CREATE INDEX "user_granted_permissions_userId_idx" ON "user_granted_permissions"("userId");
CREATE INDEX "user_granted_permissions_permission_idx" ON "user_granted_permissions"("permission");
CREATE INDEX "user_granted_permissions_expiresAt_idx" ON "user_granted_permissions"("expiresAt");
CREATE UNIQUE INDEX "user_granted_permissions_userId_permission_key" ON "user_granted_permissions"("userId", "permission");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "pricing_parameter_sets_brandId_seasonId_idx" ON "pricing_parameter_sets"("brandId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_parameter_sets_brandId_seasonId_name_key" ON "pricing_parameter_sets"("brandId", "seasonId", "name");

-- CreateIndex
CREATE INDEX "collection_layouts_brandId_seasonId_idx" ON "collection_layouts"("brandId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_layouts_brandId_seasonId_key" ON "collection_layouts"("brandId", "seasonId");

-- CreateIndex
CREATE INDEX "collection_groups_collectionLayoutId_idx" ON "collection_groups"("collectionLayoutId");

-- CreateIndex
CREATE INDEX "collection_layout_rows_collectionLayoutId_idx" ON "collection_layout_rows"("collectionLayoutId");

-- CreateIndex
CREATE INDEX "collection_layout_rows_groupId_idx" ON "collection_layout_rows"("groupId");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE INDEX "brands_isActive_name_idx" ON "brands"("isActive", "name");

-- CreateIndex
CREATE INDEX "file_objects_createdBy_idx" ON "file_objects"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_code_year_key" ON "seasons"("code", "year");

-- CreateIndex
CREATE INDEX "user_preferences_lastBrandId_idx" ON "user_preferences"("lastBrandId");

-- CreateIndex
CREATE INDEX "user_tokens_userId_type_idx" ON "user_tokens"("userId", "type");
