-- Calendar dates are read by the calendar-date helpers, which support the years 1900–9999 and throw
-- outside them: a single row out of range made every reader of it fail (a calendar page, a
-- season's milestone list, a layout's criticality, a digest). The API refuses such input; these
-- constraints keep the row from existing whoever writes it. Prisma does not model CHECK
-- constraints, so they live here only.
--
-- Validated when added: a database that already holds such a row fails this migration, and the row
-- has to be corrected first (the pre-release count of dates before 1900).
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_dates_in_supported_years" CHECK (
  "startAt" >= '1900-01-01' AND "startAt" < '10000-01-01'
  AND ("endAt" IS NULL OR ("endAt" >= '1900-01-01' AND "endAt" < '10000-01-01'))
  AND ("baselineStartAt" IS NULL OR ("baselineStartAt" >= '1900-01-01' AND "baselineStartAt" < '10000-01-01'))
  AND ("baselineEndAt" IS NULL OR ("baselineEndAt" >= '1900-01-01' AND "baselineEndAt" < '10000-01-01'))
);

ALTER TABLE "planning_groups" ADD CONSTRAINT "planning_groups_anchor_date_in_supported_years" CHECK (
  "anchorDate" IS NULL OR ("anchorDate" >= '1900-01-01' AND "anchorDate" < '10000-01-01')
);
