# ADR-036 — Date and Time Model: Moving Both Ends of a Timed Event by Calendar Days

## Status

Accepted

## Context

[ADR-035](035-date-and-time-model-calendar-days-instants-and-two-zone-roles.md) fixed Luke's date model. Its rule for moving an event by N days (§Moving and saving) moves a timed event's start keeping its wall time in a named zone and lets the end follow at the original duration, so that the interval never inverts.

Two later changes made that end wrong for the events Luke generates. Since `ceb772e1` template application writes a timed item from the start of its first day to the start of the day after its last, in the business zone, and since `e8fd01c2` deadlines read a timed end as exclusive (`deadlineDay`, `eventCalendarDays`). Such an item lasts 23 or 25 hours on a day the clock changes. Moved across the change — calendar cloning moves events with `shiftEventByDays` since `c2b6b47a` — its end lands at 01:00 or 23:00, and at 01:00 the item covers one more day and its deadline is a day late (Europe/Rome, measured):

| Item | N | Moved end | Days covered |
|---|---|---|---|
| 25 Oct 2099, the change to winter time | +7 | 01:00 on 2 Nov | 1–2 Nov, not 1 Nov |
| 22 Mar 2099 | +7, onto the change to summer time | 01:00 on 30 Mar | 29–30 Mar, not 29 Mar |
| 20 Oct – 2 Nov 2099 | +182 | 01:00 on 4 May 2100 | to 4 May, not 3 May |

Keeping each end's wall time is not enough on its own. Where a zone skips midnight the day starts at the end of the gap (Europe/Rome on 22 May 1966, America/Santiago on 6 Sep 2026), so an item ending at the start of such a day keeps a 01:00 that covers one more day once moved to an ordinary one. Day boundaries cannot be recognised end by end, though: on such a day an event that really starts at 01:00 is indistinguishable from the start of the day. And an end moved on its own can repair a source whose end precedes its start: 03:00 to 02:30 on 28 Mar 2026, moved one day, would read 03:00 to 03:30, because 02:30 does not exist on the 29th.

Alternatives considered:

- **Keep the original duration (ADR-035).** Rejected: the deadline of a day-aligned item moves whenever the move crosses a clock change.
- **Keep each end's wall time, without day boundaries.** Rejected: an item ending at the start of a day whose midnight is skipped keeps 01:00 and its deadline moves. The business zone may be any zone `TimeZoneSchema` accepts, and calendar days start in 1900.
- **A day boundary recognised end by end.** Rejected: an event starting at 01:00 on a day whose midnight is skipped would be moved to the start of the target day — a 01:00–01:30 meeting in Santiago on 6 Sep 2026, moved back a week, would read 00:00–01:30.
- **A nominal duration in days, as iCalendar's `DURATION:PnD`.** Rejected: it fits only day-aligned items, and every other end would need a second rule.

Local arithmetic elsewhere moves each end on its own: `Temporal`'s `ZonedDateTime.prototype.add` and Java's `ZonedDateTime.plusDays` work on the local time line, and a moved interval is each of its ends moved. Their policies for a repeated time differ from Luke's: `Temporal`'s `compatible` takes the first occurrence and Java keeps the offset where it can, while Luke keeps the occurrence the source was in. RFC 5545 §3.8.5.3 keeps the exact duration, for the instances of a recurrence defined with `DTEND`, not for moving one event.

## Decision

This record supersedes ADR-035 as a whole. Its decisions stand unchanged except where this section says otherwise.

The first rule of ADR-035 §Moving and saving becomes:

- Shifting by N days has one contract, in core (`shiftEventByDays`). An all-day event moves both of its days by calendar arithmetic. A timed event moves in a named zone, by its shape:
  - a day-aligned event — both ends at the start of their day there and the end after the start, as template items are — moves each end to the start of the day N days later, so it stays day-aligned also where the zone skips or repeats midnight; a date the zone skipped altogether starts when the next one does;
  - any other timed event keeps the wall time of each end, to the millisecond: a wall time the target day skips is read with the offset before the gap, as RFC 5545 and `Temporal`'s `compatible` do, and a repeated one keeps its occurrence where it exists, else the first.

  The moved end is kept only where it still comes after the moved start, as the original did; otherwise it follows the moved start at the original duration. A positive interval never collapses or inverts, a zero-length one stays zero, and an inverted one stays inverted for the caller to refuse: a shift never repairs an end before its start. N = 0 is the identity. Shifting an instant by `N × 86 400 000` ms is not a calendar shift.

## Consequences

- A moved day-aligned item covers the same number of days, and its deadline moves by exactly N days, unless its source or target days include a date the zone skipped altogether. An event whose source and target intervals contain no clock change, ends included, whose start is not a wall time the target day skips, and that is not day-aligned on a day whose midnight is skipped or repeated, moves as it did under ADR-035.
- An event with only one end at the start of its day keeps that end's wall time: ending at the start of a day whose midnight is skipped, it keeps 01:00 once moved to an ordinary day, and covers one more day. Template items are never shaped so.
- Across a clock change a timed event that is not day-aligned keeps the wall times of both ends where the moved end still follows the start, so its length in hours changes by the difference.
- References to ADR-035 for its unchanged decisions remain valid; ADR-035 stays as the historical record.

### Observed gaps

ADR-035's observed gaps, as its errata correct them when this record is accepted, are this record's; a later closure is recorded in this record's errata, citing the passage of ADR-035 and the change. Open at acceptance:

- The calendar views, event inputs, drag-and-drop moves (`moveEvent`, which keeps the duration, in the browser zone), scheduled maintenance (`scheduledAt` built in the browser zone) and the other direct formatting and local `Date` reads in the web use the browser zone.
- The instant formatters live in `utils/date.ts`, published as `@luke/core/utils/date`; it formats instants without a zone (`formatDate`) or falls back silently on an invalid one (`formatDateWithTimezone`).
- The clocks-widget zones are not validated.
- `@luke/calendar` computes the next day with `Date.UTC`; storage key partitions and the copyright year use local getters.
- The holiday import stores the dates of its external source without validating them, one row at a time.
- Zones are compared as strings: `TimezoneUpdateDialog` prompts every session for an alias pair, and `groupByTimeZone` puts aliases in separate digest and maintenance cohorts.
- The API formats some instants with `Intl.DateTimeFormat` directly (export timestamps, the greeting hour); the forex widget takes "yesterday" as the UTC date 24 hours ago.
- Exports other than the audit log do not name the zone they write in.
- `User.timezone` defaults to `Europe/Rome` in the database and its creators set no `timezone`; the CHECK constraints cover only `calendar_events` and `planning_groups`, up to the year 9999.
- The season sync stores NAV's blank date `1753-01-01` as a date.
- The `@luke` ESLint rule does not exist yet.

## Errata

Appended under [ADR-030](030-documentation-architecture-canonical-language-and-historical-records.md); the sections above are unchanged.

- **2026-10-12 — Observed gaps, "The holiday import stores the dates of its external source without validating them, one row at a time" (inherited from ADR-035).** Since `fff8b2cb` `holidays.previewImport` and `holidays.confirmImport` read Nager.Date's answer through `NagerHolidaysSchema`, whose days are `CalendarDateSchema`, before anything is written; the import is all or nothing, in one transaction, and its preview is refused whenever the import would be.
- **2026-10-12 — Observed gaps, "The API formats some instants with `Intl.DateTimeFormat` directly (export timestamps, the greeting hour)" (inherited from ADR-035).** Since `a117a15f` `exportTimestamp` and `me.getDailyGreeting` read the wall clock through `calendarDateIn` and `wallTimeIn`; the forex widget still takes "yesterday" as the UTC date 24 hours ago.
- **2026-10-12 — Observed gaps, "Exports other than the audit log do not name the zone they write in" (inherited from ADR-035, which named the collection-layout and pricing-grid PDF headers and the season-calendar PDF and XLSX).** Since `7020ef1a` the collection-layout PDFs (layout, revision and row) and the pricing-grid PDF write their extraction time in the reader zone and name it (`formatExportInstant`); since `2e725fee` the KIMO workbook writes NAV's datetimes at the reader zone's wall clock (`wallClockDate`) and names the zone in a note on their headers, NAV's blank datetime being an empty cell. The season-calendar PDF and XLSX still do not name the zone.
- **2026-10-12 — Observed gaps, "storage key partitions and the copyright year use local getters" (inherited from ADR-035).** Since `0d8a583c` every server-generated storage key — both providers and the presigned upload — is partitioned by its UTC day (`generateStorageKey`); since `239f17ad` the emails print no copyright year. `@luke/calendar` still computes the next day with `Date.UTC`.
- **2026-10-12 — Observed gaps, "the forex widget takes "yesterday" as the UTC date 24 hours ago", and the 2026-10-12 erratum above that repeats it.** Since `239f17ad` `dashboard.getForexRates` compares Frankfurter's latest fixing with its answer for the day before that fixing's date — the last ECB fixing on or before it — both read through `FrankfurterRatesSchema`.
- **2026-10-12 — Observed gaps, "`User.timezone` defaults to `Europe/Rome` in the database and its creators set no `timezone`; the CHECK constraints cover only `calendar_events` and `planning_groups`, up to the year 9999" (inherited from ADR-035).** Since `371b0da6` `users.timezone` has no default and every creator — `users.create`, the first LDAP login and the seed — writes `app.defaultTimezone`; migration `20261012220000_user_timezone_and_calendar_date_bounds` holds `calendar_events` (by `allDay`), `planning_groups`, `holidays` and `vendor_closure_periods` to ADR-035 §Bounds. `Europe/Rome` remains only as the registry default of `app.defaultTimezone`.
- **2026-10-13 — Observed gaps, "The season sync stores NAV's blank date `1753-01-01` as a date" (inherited from ADR-035).** Since `5b6b3ff6` the season sync stores `Starting Date` and `Ending Date` through `navDateOrNull` (`@luke/nav`), NAV's blank date becoming `null`, and `integrations.nav.sync.preview` sends a season's days as calendar days, a blank or out-of-range one as `null`. A `nav_seasons` row written before changes at its next sync; the `nav_pf_*` replica columns still store the blank date.
- **2026-10-13 — Observed gaps, "The calendar views, event inputs, drag-and-drop moves (`moveEvent`, which keeps the duration, in the browser zone), scheduled maintenance (`scheduledAt` built in the browser zone) and the other direct formatting and local `Date` reads in the web use the browser zone" (inherited from ADR-035), in part.** Since `dd1cb8e2` the maintenance page converts the start typed in its `datetime-local` field with the zone its form captured when it opened (`useFormZone`), named next to the field. Since `1f6b7da4`, `7521fb2f` and `dd1cb8e2` the pending-users, brand and season tables, the backup list, the restore confirmation, the maintenance banner and the maintenance page format their instants in the profile zone through `useFormatDate`; a reader without a session reads the banner in the browser zone, which every value names. The calendar views, event inputs, drag-and-drop moves and the remaining direct formatting still use the browser zone.
- **2026-10-14 — Observed gaps, "The instant formatters live in `utils/date.ts`, published as `@luke/core/utils/date`; it formats instants without a zone (`formatDate`) or falls back silently on an invalid one (`formatDateWithTimezone`)" (inherited from ADR-035).** Since [ADR-037](037-core-package-export-boundary-two-subpaths.md), which supersedes ADR-022, `utils/date.ts` and its subpath are retired: core formats an instant only through `formatInstant`, which requires a zone, and a calendar day through `formatCalendarDate`, which needs none.
- **2026-10-14 — Observed gaps, "The calendar views, event inputs, drag-and-drop moves (`moveEvent`, which keeps the duration, in the browser zone), scheduled maintenance (`scheduledAt` built in the browser zone) and the other direct formatting and local `Date` reads in the web use the browser zone" (inherited from ADR-035), in part; and the 2026-10-13 erratum above, which leaves "the remaining direct formatting" open.** Since `3b6c211e`, `1281a0ce`, `91cbdcd8`, `124eef79`, `57e8e191`, `b36c841d` and `d31a5ee9` the dashboard (greeting, date and ISO week, forex time, weekly sales), the completion and sync labels, relative times, notifications, the NAV sync and holiday import pages, the profile, the daily greeting, the digest and template dialogs, the config export name and the zone selects read the profile zone; the world clocks format through core in the zones they name, and the browser zone only proposes a profile update (`TimezoneUpdateDialog`). The calendar views, event inputs and drag-and-drop moves still use the browser zone.
