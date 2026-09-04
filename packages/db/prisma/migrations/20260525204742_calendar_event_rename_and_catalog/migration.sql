/*
  Warnings:

  - The primary key for the `google_event_mappings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `milestoneId` on the `google_event_mappings` table. All the data in the column will be lost.
  - You are about to drop the `calendar_milestones` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_personal_notes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_user_visibilities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `milestone_visibilities` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `eventId` to the `google_event_mappings` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `milestone_template_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "public"."calendar_milestones" DROP CONSTRAINT "calendar_milestones_calendarId_fkey";

-- DropForeignKey
ALTER TABLE "public"."calendar_milestones" DROP CONSTRAINT "calendar_milestones_ownerFunctionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."calendar_milestones" DROP CONSTRAINT "calendar_milestones_templateItemId_fkey";

-- DropForeignKey
ALTER TABLE "public"."google_event_mappings" DROP CONSTRAINT "google_event_mappings_milestoneId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_personal_notes" DROP CONSTRAINT "milestone_personal_notes_milestoneId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_personal_notes" DROP CONSTRAINT "milestone_personal_notes_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_user_visibilities" DROP CONSTRAINT "milestone_user_visibilities_grantedBy_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_user_visibilities" DROP CONSTRAINT "milestone_user_visibilities_milestoneId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_user_visibilities" DROP CONSTRAINT "milestone_user_visibilities_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_visibilities" DROP CONSTRAINT "milestone_visibilities_functionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."milestone_visibilities" DROP CONSTRAINT "milestone_visibilities_milestoneId_fkey";

-- Dev data cleanup: google_event_mappings references calendar_milestones which is being dropped
DELETE FROM "google_event_mappings";

-- AlterTable
ALTER TABLE "google_event_mappings" DROP CONSTRAINT "google_event_mappings_pkey",
DROP COLUMN "milestoneId",
ADD COLUMN     "eventId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "google_event_mappings_pkey" PRIMARY KEY ("eventId", "companyFunctionId");
ALTER TABLE "google_event_mappings" ALTER COLUMN "eventId" DROP DEFAULT;

-- AlterTable: cast enum→text (preserves existing values)
ALTER TABLE "milestone_template_items" ALTER COLUMN "type" TYPE TEXT;

-- DropTable
DROP TABLE "public"."calendar_milestones";

-- DropTable
DROP TABLE "public"."milestone_personal_notes";

-- DropTable
DROP TABLE "public"."milestone_user_visibilities";

-- DropTable
DROP TABLE "public"."milestone_visibilities";

-- DropEnum
DROP TYPE "public"."CalendarMilestoneStatus";

-- DropEnum
DROP TYPE "public"."CalendarMilestoneType";

-- CreateTable
CREATE TABLE "calendar_event_user_visibilities" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "calendar_event_user_visibilities_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "ownerFunctionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "publishExternally" BOOLEAN NOT NULL DEFAULT true,
    "templateItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_visibilities" (
    "eventId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "calendar_event_visibilities_pkey" PRIMARY KEY ("eventId","functionId")
);

-- CreateTable
CREATE TABLE "calendar_event_personal_notes" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_personal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_catalog_items" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_event_user_visibilities_userId_idx" ON "calendar_event_user_visibilities"("userId");

-- CreateIndex
CREATE INDEX "calendar_events_calendarId_startAt_idx" ON "calendar_events"("calendarId", "startAt");

-- CreateIndex
CREATE INDEX "calendar_events_ownerFunctionId_idx" ON "calendar_events"("ownerFunctionId");

-- CreateIndex
CREATE INDEX "calendar_event_visibilities_functionId_idx" ON "calendar_event_visibilities"("functionId");

-- CreateIndex
CREATE INDEX "calendar_event_personal_notes_userId_idx" ON "calendar_event_personal_notes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_personal_notes_eventId_userId_key" ON "calendar_event_personal_notes"("eventId", "userId");

-- CreateIndex
CREATE INDEX "calendar_catalog_items_type_isActive_idx" ON "calendar_catalog_items"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_catalog_items_type_value_key" ON "calendar_catalog_items"("type", "value");

-- AddForeignKey
ALTER TABLE "calendar_event_user_visibilities" ADD CONSTRAINT "calendar_event_user_visibilities_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_user_visibilities" ADD CONSTRAINT "calendar_event_user_visibilities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_user_visibilities" ADD CONSTRAINT "calendar_event_user_visibilities_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "season_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_ownerFunctionId_fkey" FOREIGN KEY ("ownerFunctionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "milestone_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_visibilities" ADD CONSTRAINT "calendar_event_visibilities_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_visibilities" ADD CONSTRAINT "calendar_event_visibilities_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "company_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_personal_notes" ADD CONSTRAINT "calendar_event_personal_notes_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_personal_notes" ADD CONSTRAINT "calendar_event_personal_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_event_mappings" ADD CONSTRAINT "google_event_mappings_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
