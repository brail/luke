-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "baselineEndAt" TIMESTAMP(3),
ADD COLUMN     "baselineStartAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "season_calendars" ADD COLUMN     "frozenAt" TIMESTAMP(3);
