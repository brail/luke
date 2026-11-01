-- #159, #127: the columns and the enum no code has read since 3.1.0-rc.1. Production moves from 3.0
-- straight to the release that drops them, so going back from it means restoring the database.
-- AlterTable
ALTER TABLE "phases" DROP COLUMN "code",
DROP COLUMN "order";

-- AlterTable
ALTER TABLE "season_calendars" DROP COLUMN "status";

-- DropEnum
DROP TYPE "SeasonCalendarStatus";

-- #128: only the default group has no stored name. An image from before
-- `20261024194219_default_planning_group_by_flag`, restored after it ran, creates its default group
-- with a name again, so the names are cleared once more before the constraint holds them.
--
-- This appended step is safe to run twice; the generated drops above are not.
UPDATE "planning_groups"
SET "name" = NULL
WHERE "isDefault" AND "name" IS NOT NULL;

ALTER TABLE "planning_groups" DROP CONSTRAINT IF EXISTS "planning_groups_default_has_no_name";

ALTER TABLE "planning_groups"
ADD CONSTRAINT "planning_groups_default_has_no_name" CHECK ("isDefault" = ("name" IS NULL));
