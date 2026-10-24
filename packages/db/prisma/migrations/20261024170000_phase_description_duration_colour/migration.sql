-- #158: a phase gets a description, a duration and a colour.
-- AlterTable
ALTER TABLE "phases" ADD COLUMN     "color" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "durationDays" INTEGER;

-- Backfill: each phase gets the colour its badge shows today, so the collection layout looks the
-- same on release. Until now the badge colour was derived from the catalog order
-- (`phaseBadgeClassName` in the web app): tier `min(3, floor(order / (active - 1) * 4))` over
-- gray, yellow, blue, green, on the raw stored `order`, where `active` is the number of active
-- phases and a catalog of at most one active phase is gray. Retired phases are included: a
-- concluded row can still sit on one, and its badge shows a tier too. The rule and the colour keys
-- (`PHASE_COLORS` in `@luke/core`) are frozen here, so a replay on an older backup does not depend
-- on later code.
--
-- Safe to run twice: only phases with no colour are written.
UPDATE "phases" p
SET "color" = (ARRAY['gray', 'yellow', 'blue', 'green'])[
  1 + CASE WHEN c.active <= 1 THEN 0
           ELSE LEAST(3, FLOOR(p."order"::numeric / (c.active - 1) * 4)::int)
      END]
FROM (SELECT count(*) AS active FROM "phases" WHERE "isActive") c
WHERE p."color" IS NULL;
