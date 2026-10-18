-- CreateEnum
CREATE TYPE "CalendarDaysRelevance" AS ENUM ('COMPANY', 'VENDOR', 'BOTH');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "calendarDaysRelevance" "CalendarDaysRelevance";

-- AlterTable
ALTER TABLE "milestone_template_items" ADD COLUMN     "calendarDaysRelevance" "CalendarDaysRelevance";
