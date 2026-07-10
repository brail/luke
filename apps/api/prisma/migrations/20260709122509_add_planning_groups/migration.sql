/*
  Warnings:

  - You are about to drop the column `anchorDate` on the `season_calendars` table. All the data in the column will be lost.
  - You are about to drop the column `frozenAt` on the `season_calendars` table. All the data in the column will be lost.
  - You are about to drop the `calendar_event_anchors` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `planningGroupId` to the `calendar_events` table (backfilled below, no data loss).
  - Added the required column `planningGroupId` to the `collection_layout_rows` table (backfilled below, no data loss).

*/

-- CreateTable
CREATE TABLE "planning_groups" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "anchorDate" DATE,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planning_groups_calendarId_idx" ON "planning_groups"("calendarId");

-- Enforce "at most one default group per calendar" at the DB level (a plain composite unique on
-- (calendarId, isDefault) would also wrongly block multiple non-default groups on the same calendar).
CREATE UNIQUE INDEX "planning_groups_one_default_per_calendar" ON "planning_groups"("calendarId") WHERE "isDefault";

-- AddForeignKey
ALTER TABLE "planning_groups" ADD CONSTRAINT "planning_groups_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "season_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill step 1: ensure a SeasonCalendar exists for every (brandId, seasonId) that already has a
-- CollectionLayout, even if no calendar was ever created for it — otherwise the row backfill below
-- (joining collection_layout_rows -> collection_layouts -> season_calendars) would leave orphans.
INSERT INTO "season_calendars" ("id", "brandId", "seasonId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, cl."brandId", cl."seasonId", 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "collection_layouts" cl
WHERE NOT EXISTS (
  SELECT 1 FROM "season_calendars" sc WHERE sc."brandId" = cl."brandId" AND sc."seasonId" = cl."seasonId"
);

-- Backfill step 2: one default PlanningGroup per SeasonCalendar, inheriting the calendar's own
-- anchorDate/frozenAt (still present on season_calendars at this point in the migration).
INSERT INTO "planning_groups" ("id", "calendarId", "name", "isDefault", "anchorDate", "frozenAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, sc."id", 'Predefinito', true, sc."anchorDate", sc."frozenAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "season_calendars" sc;

-- AlterTable: calendar_events.planningGroupId — nullable first, backfill, then enforce NOT NULL.
ALTER TABLE "calendar_events" ADD COLUMN "planningGroupId" TEXT;

UPDATE "calendar_events" e
SET "planningGroupId" = pg."id"
FROM "planning_groups" pg
WHERE pg."calendarId" = e."calendarId" AND pg."isDefault" = true;

ALTER TABLE "calendar_events" ALTER COLUMN "planningGroupId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "calendar_events_planningGroupId_idx" ON "calendar_events"("planningGroupId");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_planningGroupId_fkey" FOREIGN KEY ("planningGroupId") REFERENCES "planning_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: collection_layout_rows.planningGroupId — nullable first, backfill via the
-- layout -> (brandId, seasonId) -> season_calendar -> default planning_group join, then NOT NULL.
ALTER TABLE "collection_layout_rows" ADD COLUMN "planningGroupId" TEXT;

UPDATE "collection_layout_rows" r
SET "planningGroupId" = pg."id"
FROM "collection_layouts" cl
JOIN "season_calendars" sc ON sc."brandId" = cl."brandId" AND sc."seasonId" = cl."seasonId"
JOIN "planning_groups" pg ON pg."calendarId" = sc."id" AND pg."isDefault" = true
WHERE r."collectionLayoutId" = cl."id";

ALTER TABLE "collection_layout_rows" ALTER COLUMN "planningGroupId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "collection_layout_rows_planningGroupId_idx" ON "collection_layout_rows"("planningGroupId");

-- AddForeignKey
ALTER TABLE "collection_layout_rows" ADD CONSTRAINT "collection_layout_rows_planningGroupId_fkey" FOREIGN KEY ("planningGroupId") REFERENCES "planning_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: drop the now-superseded calendar-level anchor/freeze fields.
ALTER TABLE "season_calendars" DROP COLUMN "anchorDate",
DROP COLUMN "frozenAt";

-- DropForeignKey
ALTER TABLE "calendar_event_anchors" DROP CONSTRAINT "calendar_event_anchors_eventId_fkey";

-- DropTable
DROP TABLE "calendar_event_anchors";

-- DropEnum
DROP TYPE "AnchorEntityType";
