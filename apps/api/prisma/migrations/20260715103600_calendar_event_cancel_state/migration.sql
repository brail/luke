-- Replace the CalendarEvent workflow status enum (PLANNED/IN_PROGRESS/COMPLETED/CANCELLED) with a
-- two-state cancellation model (active / cancelled). Completion is no longer an event state — the
-- truth of "phase done" lives per-row in collection_row_phase_history. See
-- project_calendar_event_maintainability for the full design.

-- Add cancellation columns (all nullable → every existing event defaults to "active").
ALTER TABLE "calendar_events"
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT;

-- Data migration: retire previously-CANCELLED events into the new model. Runs while the status
-- column still exists. cancelledByUserId stays null (the original actor is unknown at migration time).
UPDATE "calendar_events"
SET "cancelledAt" = "updatedAt",
    "cancelReason" = 'Migrato da stato CANCELLED'
WHERE "status" = 'CANCELLED';

-- Drop the legacy status column and its enum type.
ALTER TABLE "calendar_events" DROP COLUMN "status";
DROP TYPE "CalendarEventStatus";

-- FK for the cancelling user.
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: at most one ACTIVE (non-cancelled) phase-concluding event per planning group.
-- Not expressible in the Prisma schema (partial predicate), hand-authored here. A cancelled event
-- frees the slot; `phaseId IS NOT NULL` excludes non-productive events (review meetings) with no phase.
CREATE UNIQUE INDEX "calendar_events_group_phase_active_uq"
  ON "calendar_events" ("planningGroupId", "phaseId")
  WHERE "cancelledAt" IS NULL AND "phaseId" IS NOT NULL;
