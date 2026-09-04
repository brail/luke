-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('LOCAL', 'LDAP', 'OIDC');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('RESET', 'VERIFY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'it-IT',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_credentials" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "result" TEXT NOT NULL,
    "metadata" JSONB,
    "traceId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCleanupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_section_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_section_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" TEXT NOT NULL,
    "lastBrandId" TEXT,
    "lastSeasonId" TEXT,
    "pinnedContexts" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_granted_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_granted_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_audits" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT,
    "oldRole" "Role",
    "newRole" "Role",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_parameter_sets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchaseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "sellingCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "qualityControlPercent" DOUBLE PRECISION NOT NULL,
    "transportInsuranceCost" DOUBLE PRECISION NOT NULL,
    "duty" DOUBLE PRECISION NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL,
    "italyAccessoryCosts" DOUBLE PRECISION NOT NULL,
    "tools" DOUBLE PRECISION NOT NULL,
    "retailMultiplier" DOUBLE PRECISION NOT NULL,
    "optimalMargin" DOUBLE PRECISION NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_layouts" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "skuBudget" INTEGER,
    "hiddenColumns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_groups" (
    "id" TEXT NOT NULL,
    "collectionLayoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "skuBudget" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_layout_rows" (
    "id" TEXT NOT NULL,
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
    "retailTargetPrice" DOUBLE PRECISION,
    "buyingTargetPrice" DOUBLE PRECISION,
    "supplierFirstQuotation" DOUBLE PRECISION,
    "toolingQuotation" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_layout_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_providerId_key" ON "identities"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "local_credentials_identityId_key" ON "local_credentials"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "app_configs_key_key" ON "app_configs"("key");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "user_tokens_type_tokenHash_idx" ON "user_tokens"("type", "tokenHash");

-- CreateIndex
CREATE INDEX "user_tokens_userId_type_idx" ON "user_tokens"("userId", "type");

-- CreateIndex
CREATE INDEX "file_objects_bucket_key_idx" ON "file_objects"("bucket", "key");

-- CreateIndex
CREATE INDEX "file_objects_createdAt_idx" ON "file_objects"("createdAt");

-- CreateIndex
CREATE INDEX "file_objects_createdBy_idx" ON "file_objects"("createdBy");

-- CreateIndex
CREATE INDEX "file_objects_cleanupStatus_idx" ON "file_objects"("cleanupStatus");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_bucket_key_key" ON "file_objects"("bucket", "key");

-- CreateIndex
CREATE INDEX "user_section_access_userId_section_idx" ON "user_section_access"("userId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "user_section_access_userId_section_key" ON "user_section_access"("userId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "brands_code_key" ON "brands"("code");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE INDEX "brands_isActive_name_idx" ON "brands"("isActive", "name");

-- CreateIndex
CREATE INDEX "seasons_code_year_idx" ON "seasons"("code", "year");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_code_year_key" ON "seasons"("code", "year");

-- CreateIndex
CREATE INDEX "user_preferences_lastBrandId_idx" ON "user_preferences"("lastBrandId");

-- CreateIndex
CREATE INDEX "user_granted_permissions_userId_idx" ON "user_granted_permissions"("userId");

-- CreateIndex
CREATE INDEX "user_granted_permissions_permission_idx" ON "user_granted_permissions"("permission");

-- CreateIndex
CREATE INDEX "user_granted_permissions_expiresAt_idx" ON "user_granted_permissions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_granted_permissions_userId_permission_key" ON "user_granted_permissions"("userId", "permission");

-- CreateIndex
CREATE INDEX "permission_audits_action_createdAt_idx" ON "permission_audits"("action", "createdAt");

-- CreateIndex
CREATE INDEX "permission_audits_userId_idx" ON "permission_audits"("userId");

-- CreateIndex
CREATE INDEX "permission_audits_actorId_idx" ON "permission_audits"("actorId");

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

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_section_access" ADD CONSTRAINT "user_section_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_granted_permissions" ADD CONSTRAINT "user_granted_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_granted_permissions" ADD CONSTRAINT "user_granted_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audits" ADD CONSTRAINT "permission_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audits" ADD CONSTRAINT "permission_audits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_parameter_sets" ADD CONSTRAINT "pricing_parameter_sets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_parameter_sets" ADD CONSTRAINT "pricing_parameter_sets_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layouts" ADD CONSTRAINT "collection_layouts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layouts" ADD CONSTRAINT "collection_layouts_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_groups" ADD CONSTRAINT "collection_groups_collectionLayoutId_fkey" FOREIGN KEY ("collectionLayoutId") REFERENCES "collection_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_rows" ADD CONSTRAINT "collection_layout_rows_collectionLayoutId_fkey" FOREIGN KEY ("collectionLayoutId") REFERENCES "collection_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_rows" ADD CONSTRAINT "collection_layout_rows_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "collection_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_layout_rows" ADD CONSTRAINT "collection_layout_rows_pricingParameterSetId_fkey" FOREIGN KEY ("pricingParameterSetId") REFERENCES "pricing_parameter_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
