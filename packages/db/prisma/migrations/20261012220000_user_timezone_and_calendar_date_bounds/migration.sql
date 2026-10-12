-- ADR-035 §New users: a new user takes the business zone when created, so `users.timezone` keeps no
-- default — a second copy of the business-zone default that would not follow it when it changes.
-- Stored zones are left as they are. An application older than this cannot create users on this
-- schema: a rollback that keeps the database restores it too (docs/upgrade-2.1-to-3.0.md §10;
-- the header of docker-compose.rc.yml for the RC).
ALTER TABLE "users" ALTER COLUMN "timezone" DROP DEFAULT;

-- ADR-035 §Bounds: calendar values held to the range the API writes, whoever writes them. Calendar
-- days 1900-01-01 to 9999-12-30, so every day has a next one; an all-day value within the UTC
-- midnights of those days (that it is a midnight is `assertEventDates`'s rule, not checked here); a
-- timed instant in [1900-01-02, 9999-12-30), so that in every zone from UTC−12 to UTC+14 its day
-- exists and has a next one. A baseline is checked as an instant whatever `allDay`
-- says now: it was captured when the event was frozen. Prisma does not model CHECK constraints, so
-- they live here only; the names of the two from 20260929224334 are kept, their bounds narrowed.
--
-- Validated when added: a database that holds a row outside these bounds fails this migration, and
-- the row has to be corrected first. The pre-release count was 0 on RC and production (2026-10-12).
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_dates_in_supported_years";
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_dates_in_supported_years" CHECK (
  CASE WHEN "allDay"
    THEN "startAt" >= '1900-01-01' AND "startAt" < '9999-12-31'
      AND ("endAt" IS NULL OR ("endAt" >= '1900-01-01' AND "endAt" < '9999-12-31'))
    ELSE "startAt" >= '1900-01-02' AND "startAt" < '9999-12-30'
      AND ("endAt" IS NULL OR ("endAt" >= '1900-01-02' AND "endAt" < '9999-12-30'))
  END
  AND ("baselineStartAt" IS NULL OR ("baselineStartAt" >= '1900-01-01' AND "baselineStartAt" < '9999-12-31'))
  AND ("baselineEndAt" IS NULL OR ("baselineEndAt" >= '1900-01-01' AND "baselineEndAt" < '9999-12-31'))
);

ALTER TABLE "planning_groups" DROP CONSTRAINT "planning_groups_anchor_date_in_supported_years";
ALTER TABLE "planning_groups" ADD CONSTRAINT "planning_groups_anchor_date_in_supported_years" CHECK (
  "anchorDate" IS NULL OR "anchorDate" BETWEEN '1900-01-01' AND '9999-12-30'
);

ALTER TABLE "holidays" ADD CONSTRAINT "holidays_dates_in_supported_years" CHECK (
  "startDate" BETWEEN '1900-01-01' AND '9999-12-30' AND "endDate" BETWEEN '1900-01-01' AND '9999-12-30'
);

ALTER TABLE "vendor_closure_periods" ADD CONSTRAINT "vendor_closure_periods_dates_in_supported_years" CHECK (
  "startDate" BETWEEN '1900-01-01' AND '9999-12-30' AND "endDate" BETWEEN '1900-01-01' AND '9999-12-30'
);
