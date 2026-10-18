-- CreateEnum
CREATE TYPE "DependencySeverity" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('CRITICAL', 'NORMAL', 'INFO');

-- CreateEnum
CREATE TYPE "StateEffectType" AS ENUM ('LOCK_COLLECTION_LAYOUT', 'UNLOCK_COLLECTION_LAYOUT');

-- CreateEnum
CREATE TYPE "AnchorEntityType" AS ENUM ('COLLECTION_LAYOUT', 'COLLECTION_LAYOUT_ROW');

-- CreateEnum
CREATE TYPE "VendorOverrideType" AS ENUM ('CLOSURE', 'OPEN');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "relevantCountries" TEXT[],
ADD COLUMN     "severity" "EventSeverity" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "collection_layouts" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedByEventId" TEXT;

-- AlterTable
ALTER TABLE "milestone_template_items" ADD COLUMN     "relevantCountries" TEXT[],
ADD COLUMN     "severity" "EventSeverity" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "milestone_template_dependencies" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "minGapDays" INTEGER,
    "maxGapDays" INTEGER,
    "severity" "DependencySeverity" NOT NULL,
    "reason" VARCHAR(500),

    CONSTRAINT "milestone_template_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_dependencies" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "minGapDays" INTEGER,
    "maxGapDays" INTEGER,
    "severity" "DependencySeverity" NOT NULL,
    "reason" VARCHAR(500),
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "inheritedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_template_state_effects" (
    "id" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "effectType" "StateEffectType" NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "milestone_template_state_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_state_effects" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "effectType" "StateEffectType" NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "requiresConfirmation" BOOLEAN NOT NULL,

    CONSTRAINT "calendar_event_state_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_effect_executions" (
    "id" TEXT NOT NULL,
    "effectId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedByUserId" TEXT NOT NULL,
    "previousStateSnapshot" JSONB NOT NULL,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackByUserId" TEXT,

    CONSTRAINT "calendar_event_effect_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_anchors" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "entityType" "AnchorEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_countries" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "holiday_countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isReligious" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_closure_periods" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "countryCode" TEXT,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" "VendorOverrideType" NOT NULL DEFAULT 'CLOSURE',
    "sourceHolidayId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_closure_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_template_dependencies_successorId_idx" ON "milestone_template_dependencies"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_template_dependencies_predecessorId_successorId_key" ON "milestone_template_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "calendar_event_dependencies_successorId_idx" ON "calendar_event_dependencies"("successorId");

-- CreateIndex
CREATE INDEX "calendar_event_dependencies_inheritedFromId_idx" ON "calendar_event_dependencies"("inheritedFromId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_dependencies_predecessorId_successorId_key" ON "calendar_event_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "milestone_template_state_effects_templateItemId_idx" ON "milestone_template_state_effects"("templateItemId");

-- CreateIndex
CREATE INDEX "calendar_event_state_effects_eventId_idx" ON "calendar_event_state_effects"("eventId");

-- CreateIndex
CREATE INDEX "calendar_event_state_effects_targetEntityType_targetEntityI_idx" ON "calendar_event_state_effects"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "calendar_event_effect_executions_eventId_idx" ON "calendar_event_effect_executions"("eventId");

-- CreateIndex
CREATE INDEX "calendar_event_effect_executions_effectId_idx" ON "calendar_event_effect_executions"("effectId");

-- CreateIndex
CREATE INDEX "calendar_event_anchors_entityType_entityId_idx" ON "calendar_event_anchors"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_anchors_eventId_entityType_entityId_key" ON "calendar_event_anchors"("eventId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "holidays_countryCode_startDate_endDate_idx" ON "holidays"("countryCode", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_countryCode_name_startDate_key" ON "holidays"("countryCode", "name", "startDate");

-- CreateIndex
CREATE INDEX "vendor_closure_periods_vendorId_seasonId_idx" ON "vendor_closure_periods"("vendorId", "seasonId");

-- CreateIndex
CREATE INDEX "vendor_closure_periods_seasonId_startDate_endDate_idx" ON "vendor_closure_periods"("seasonId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "collection_layouts_lockedByEventId_idx" ON "collection_layouts"("lockedByEventId");

-- AddForeignKey
ALTER TABLE "collection_layouts" ADD CONSTRAINT "collection_layouts_lockedByEventId_fkey" FOREIGN KEY ("lockedByEventId") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_dependencies" ADD CONSTRAINT "milestone_template_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "milestone_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_dependencies" ADD CONSTRAINT "milestone_template_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "milestone_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_dependencies" ADD CONSTRAINT "calendar_event_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_dependencies" ADD CONSTRAINT "calendar_event_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_state_effects" ADD CONSTRAINT "milestone_template_state_effects_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "milestone_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_state_effects" ADD CONSTRAINT "calendar_event_state_effects_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_effect_executions" ADD CONSTRAINT "calendar_event_effect_executions_effectId_fkey" FOREIGN KEY ("effectId") REFERENCES "calendar_event_state_effects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_effect_executions" ADD CONSTRAINT "calendar_event_effect_executions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_effect_executions" ADD CONSTRAINT "calendar_event_effect_executions_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_effect_executions" ADD CONSTRAINT "calendar_event_effect_executions_rolledBackByUserId_fkey" FOREIGN KEY ("rolledBackByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_anchors" ADD CONSTRAINT "calendar_event_anchors_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "holiday_countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "holiday_countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_sourceHolidayId_fkey" FOREIGN KEY ("sourceHolidayId") REFERENCES "holidays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: remove MILESTONE event type
UPDATE "calendar_events" SET "type" = 'GATE' WHERE "type" = 'MILESTONE';
UPDATE "milestone_template_items" SET "type" = 'GATE' WHERE "type" = 'MILESTONE';
UPDATE "calendar_catalog_items" SET "isActive" = false WHERE "value" = 'MILESTONE' AND "type" = 'eventType';
