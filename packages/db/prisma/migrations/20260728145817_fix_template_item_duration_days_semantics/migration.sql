-- Backfill BEFORE changing the default: durationDays=0 meant "1 real day" under the old
-- offset-based semantics. Every existing row must be bumped by 1 so its real-world meaning
-- is preserved under the new 1-based semantics, in the same migration as the default change.
UPDATE "milestone_template_items" SET "durationDays" = "durationDays" + 1;

-- AlterTable
ALTER TABLE "milestone_template_items" ALTER COLUMN "durationDays" SET DEFAULT 1;
