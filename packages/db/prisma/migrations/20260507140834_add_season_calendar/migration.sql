-- CreateEnum
CREATE TYPE "SeasonCalendarStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CalendarMilestoneType" AS ENUM ('KICKOFF', 'REVIEW', 'GATE', 'DEADLINE', 'MILESTONE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CalendarMilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "season_calendars" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "SeasonCalendarStatus" NOT NULL DEFAULT 'DRAFT',
    "anchorDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_milestones" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "ownerSectionKey" TEXT NOT NULL,
    "type" "CalendarMilestoneType" NOT NULL,
    "status" "CalendarMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "publishExternally" BOOLEAN NOT NULL DEFAULT true,
    "templateItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_visibilities" (
    "milestoneId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "milestone_visibilities_pkey" PRIMARY KEY ("milestoneId","sectionKey")
);

-- CreateTable
CREATE TABLE "milestone_personal_notes" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_personal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerSectionKey" TEXT NOT NULL,
    "type" "CalendarMilestoneType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "offsetDays" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 0,
    "publishExternally" BOOLEAN NOT NULL DEFAULT true,
    "visibleSectionKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_calendar_bindings" (
    "id" TEXT NOT NULL,
    "seasonCalendarId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "isProvisioned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_event_mappings" (
    "milestoneId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_event_mappings_pkey" PRIMARY KEY ("milestoneId","sectionKey")
);

-- CreateIndex
CREATE INDEX "season_calendars_seasonId_idx" ON "season_calendars"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_calendars_brandId_seasonId_key" ON "season_calendars"("brandId", "seasonId");

-- CreateIndex
CREATE INDEX "calendar_milestones_calendarId_startAt_idx" ON "calendar_milestones"("calendarId", "startAt");

-- CreateIndex
CREATE INDEX "calendar_milestones_ownerSectionKey_idx" ON "calendar_milestones"("ownerSectionKey");

-- CreateIndex
CREATE INDEX "milestone_visibilities_sectionKey_idx" ON "milestone_visibilities"("sectionKey");

-- CreateIndex
CREATE INDEX "milestone_personal_notes_userId_idx" ON "milestone_personal_notes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_personal_notes_milestoneId_userId_key" ON "milestone_personal_notes"("milestoneId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_templates_name_key" ON "milestone_templates"("name");

-- CreateIndex
CREATE INDEX "milestone_template_items_templateId_idx" ON "milestone_template_items"("templateId");

-- CreateIndex
CREATE INDEX "google_calendar_bindings_googleCalendarId_idx" ON "google_calendar_bindings"("googleCalendarId");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_bindings_seasonCalendarId_sectionKey_key" ON "google_calendar_bindings"("seasonCalendarId", "sectionKey");

-- CreateIndex
CREATE INDEX "google_event_mappings_googleCalendarId_idx" ON "google_event_mappings"("googleCalendarId");

-- AddForeignKey
ALTER TABLE "season_calendars" ADD CONSTRAINT "season_calendars_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_calendars" ADD CONSTRAINT "season_calendars_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_milestones" ADD CONSTRAINT "calendar_milestones_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "season_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_milestones" ADD CONSTRAINT "calendar_milestones_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "milestone_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_visibilities" ADD CONSTRAINT "milestone_visibilities_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "calendar_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_personal_notes" ADD CONSTRAINT "milestone_personal_notes_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "calendar_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_personal_notes" ADD CONSTRAINT "milestone_personal_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_template_items" ADD CONSTRAINT "milestone_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "milestone_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_bindings" ADD CONSTRAINT "google_calendar_bindings_seasonCalendarId_fkey" FOREIGN KEY ("seasonCalendarId") REFERENCES "season_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_event_mappings" ADD CONSTRAINT "google_event_mappings_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "calendar_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
