-- #128: the default planning group is identified by `isDefault`, never by its name.
-- AlterTable
ALTER TABLE "planning_groups" ALTER COLUMN "name" DROP NOT NULL;

-- Data step. Until now the default group was stored with the name 'Predefinito', so a user group of
-- that name in a calendar with no default group blocked the default group's creation. Such a group
-- becomes its calendar's default group: its rows and events stay where they are, and no second
-- group appears (`@@unique([calendarId, name])` allows one per calendar, so one default each). Then
-- the default group's name is cleared: it is displayed as a UI string, not stored. The name and
-- the rule are frozen here, so a replay on an older backup does not depend on later code.
--
-- Safe to run twice: a calendar that has a default group is not touched by the first statement,
-- and the second only clears names still set.
UPDATE "planning_groups" g
SET "isDefault" = true
WHERE g."name" = 'Predefinito'
  AND NOT g."isDefault"
  AND NOT EXISTS (
    SELECT 1 FROM "planning_groups" d WHERE d."calendarId" = g."calendarId" AND d."isDefault"
  );

UPDATE "planning_groups"
SET "name" = NULL
WHERE "isDefault" AND "name" IS NOT NULL;
