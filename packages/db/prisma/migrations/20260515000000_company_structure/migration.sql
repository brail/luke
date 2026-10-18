-- Truncate calendar data to allow NOT NULL columns without defaults (D9: dev-only, 2 test users)
TRUNCATE TABLE "season_calendars" CASCADE;
TRUNCATE TABLE "milestone_template_items" CASCADE;

-- DropForeignKey
ALTER TABLE "public"."user_brand_access" DROP CONSTRAINT "user_brand_access_brandId_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_brand_access" DROP CONSTRAINT "user_brand_access_userId_fkey";

-- DropIndex
DROP INDEX "public"."calendar_milestones_ownerSectionKey_idx";

-- DropIndex
DROP INDEX "public"."google_calendar_bindings_seasonCalendarId_sectionKey_key";

-- DropIndex
DROP INDEX "public"."milestone_visibilities_sectionKey_idx";

-- AlterTable
ALTER TABLE "calendar_milestones" DROP COLUMN "ownerSectionKey",
ADD COLUMN     "ownerFunctionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "google_calendar_bindings" DROP COLUMN "sectionKey",
ADD COLUMN     "companyFunctionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "google_event_mappings" DROP CONSTRAINT "google_event_mappings_pkey",
DROP COLUMN "sectionKey",
ADD COLUMN     "companyFunctionId" TEXT NOT NULL,
ADD CONSTRAINT "google_event_mappings_pkey" PRIMARY KEY ("milestoneId", "companyFunctionId");

-- AlterTable
ALTER TABLE "milestone_template_items" DROP COLUMN "ownerSectionKey",
DROP COLUMN "visibleSectionKeys",
ADD COLUMN     "ownerFunctionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "milestone_visibilities" DROP CONSTRAINT "milestone_visibilities_pkey",
DROP COLUMN "sectionKey",
ADD COLUMN     "functionId" TEXT NOT NULL,
ADD CONSTRAINT "milestone_visibilities_pkey" PRIMARY KEY ("milestoneId", "functionId");

-- DropTable
DROP TABLE "public"."user_brand_access";

-- CreateTable
CREATE TABLE "company_profile" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "vatNumber" TEXT,
    "taxCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" JSONB,
    "exportSettings" JSONB,
    "logoKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_functions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_teams" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_team_memberships" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_team_memberships_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "company_team_brand_scopes" (
    "teamId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "company_team_brand_scopes_pkey" PRIMARY KEY ("teamId","brandId")
);

-- CreateTable
CREATE TABLE "milestone_user_visibilities" (
    "milestoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "milestone_user_visibilities_pkey" PRIMARY KEY ("milestoneId","userId")
);

-- CreateTable
CREATE TABLE "milestone_template_item_visibilities" (
    "templateItemId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,

    CONSTRAINT "milestone_template_item_visibilities_pkey" PRIMARY KEY ("templateItemId","functionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_functions_slug_key" ON "company_functions"("slug");

-- CreateIndex
CREATE INDEX "company_functions_isActive_order_idx" ON "company_functions"("isActive", "order");

-- CreateIndex
CREATE INDEX "company_teams_functionId_idx" ON "company_teams"("functionId");

-- CreateIndex
CREATE UNIQUE INDEX "company_teams_functionId_name_key" ON "company_teams"("functionId", "name");

-- CreateIndex
CREATE INDEX "company_team_memberships_userId_idx" ON "company_team_memberships"("userId");

-- CreateIndex
CREATE INDEX "company_team_brand_scopes_brandId_idx" ON "company_team_brand_scopes"("brandId");

-- CreateIndex
CREATE INDEX "milestone_user_visibilities_userId_idx" ON "milestone_user_visibilities"("userId");

-- CreateIndex
CREATE INDEX "milestone_template_item_visibilities_functionId_idx" ON "milestone_template_item_visibilities"("functionId");

-- CreateIndex
CREATE INDEX "calendar_milestones_ownerFunctionId_idx" ON "calendar_milestones"("ownerFunctionId");

-- CreateIndex
CREATE INDEX "google_calendar_bindings_companyFunctionId_idx" ON "google_calendar_bindings"("companyFunctionId");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_bindings_seasonCalendarId_companyFunctionId_key" ON "google_calendar_bindings"("seasonCalendarId", "companyFunctionId");

-- CreateIndex
CREATE INDEX "milestone_template_items_ownerFunctionId_idx" ON "milestone_template_items"("ownerFunctionId");

-- CreateIndex
CREATE INDEX "milestone_visibilities_functionId_idx" ON "milestone_visibilities"("functionId");

-- AddForeignKey
ALTER TABLE "company_teams" ADD CONSTRAINT "company_teams_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_team_memberships" ADD CONSTRAINT "company_team_memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "company_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_team_memberships" ADD CONSTRAINT "company_team_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_team_brand_scopes" ADD CONSTRAINT "company_team_brand_scopes_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "company_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_team_brand_scopes" ADD CONSTRAINT "company_team_brand_scopes_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_user_visibilities" ADD CONSTRAINT "milestone_user_visibilities_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "calendar_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_user_visibilities" ADD CONSTRAINT "milestone_user_visibilities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_user_visibilities" ADD CONSTRAINT "milestone_user_visibilities_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_item_visibilities" ADD CONSTRAINT "milestone_template_item_visibilities_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "milestone_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_item_visibilities" ADD CONSTRAINT "milestone_template_item_visibilities_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_milestones" ADD CONSTRAINT "calendar_milestones_ownerFunctionId_fkey" FOREIGN KEY ("ownerFunctionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_visibilities" ADD CONSTRAINT "milestone_visibilities_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_items" ADD CONSTRAINT "milestone_template_items_ownerFunctionId_fkey" FOREIGN KEY ("ownerFunctionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_bindings" ADD CONSTRAINT "google_calendar_bindings_companyFunctionId_fkey" FOREIGN KEY ("companyFunctionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_event_mappings" ADD CONSTRAINT "google_event_mappings_companyFunctionId_fkey" FOREIGN KEY ("companyFunctionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL additions (post-Prisma-generated DDL)

-- Unique partial index: at most one main team per function
CREATE UNIQUE INDEX "company_teams_one_main_per_function"
  ON "company_teams" ("functionId")
  WHERE "isMain" = true;

-- Singleton constraint: company_profile can only have id='singleton'
ALTER TABLE "company_profile"
  ADD CONSTRAINT "company_profile_singleton" CHECK (id = 'singleton');

-- Drop planning.* section overrides from user_section_access
DELETE FROM "user_section_access"
  WHERE "section" IN ('planning.sales', 'planning.product', 'planning.sourcing', 'planning.merchandising');

-- Invalidate all existing sessions (sectionEnum changed, team membership required)
UPDATE "users" SET "tokenVersion" = "tokenVersion" + 1;
