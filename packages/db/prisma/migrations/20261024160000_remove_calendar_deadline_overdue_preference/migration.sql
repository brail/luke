-- #171: the event-level overdue notice is gone, and with it the CALENDAR event key
-- `CALENDAR_DEADLINE_OVERDUE` (`CALENDAR_DEADLINE_KEYS` in `@luke/core`). This removes the per-user
-- preferences stored for that key, so no stored `eventKey` falls outside the allowlist. The readers
-- ask only for the keys they know, so a row left behind would be ignored, never an error.
--
-- Data only: no schema change. Safe to run twice — a second run deletes nothing.
DELETE FROM "notification_preferences"
WHERE "category" = 'CALENDAR' AND "eventKey" = 'CALENDAR_DEADLINE_OVERDUE';
