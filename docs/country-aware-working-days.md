# Country-Aware Working Days

**Status**: implemented on 2026-07-10 in `3b4c5176` (migration
`20260710184607_add_calendar_days_relevance`). Later commits changed parts of
it; see [Changes since the original design](#changes-since-the-original-design).

## Problem

The collection alert engine (`apps/api/src/services/phaseAlert.service.ts`)
measures each collection-layout row against the deadline of its active phase
milestone. That count used to be plain calendar days (`daysBetween`): weekends
included, no holiday excluded. For phases carried out at a foreign vendor, such
as sample production in China, this overstates the time actually available. A
Chinese public holiday is not a working day for that phase, even when Italy
works normally.

The feature, which came out of the calendar/planning/alert UX review of
2026-07-10, lets a milestone opt into counting only the working days that matter
to it. It does this without bringing back the per-event configuration removed
earlier that month.

## Non-goals

- **No free per-event country list.** The country is always derived from data
  that already exists (the row's vendor, the company profile) and is never typed
  in. The per-event `relevantCountries` field and the what-if dependency solver
  (`packages/calendar/src/solver/`) were removed on 2026-07-01 because they
  demanded a lot of configuration for little use; see
  [what-if-calendar-solver.md](archive/what-if-calendar-solver.md). This feature
  brings back none of it: no dependency graph between milestones and no
  drag-preview simulation. It is a single three-value enum.
- **No new AppConfig key.** The company's country is the existing
  `CompanyProfile.countryCode`.
- **No change to the calendar milestone notification windows.** See
  [Downstream effects](#downstream-effects).

## Data model

One nullable enum, set on the milestone and on the template item it can be
generated from (`packages/db/prisma/calendar.prisma`):

```prisma
enum CalendarDaysRelevance {
  COMPANY
  VENDOR
  BOTH
}
```

| Model | Field |
| --- | --- |
| `CalendarEvent` | `calendarDaysRelevance CalendarDaysRelevance?` |
| `MilestoneTemplateItem` | `calendarDaysRelevance CalendarDaysRelevance?` |

- `null` is the default for existing and new records. It keeps the plain
  calendar-day count, so opting in is a per-event choice and changes nothing for
  events that don't opt in.
- On the Zod side, `CALENDAR_DAYS_RELEVANCE` / `CalendarDaysRelevance` in
  `packages/core/src/schemas/seasonCalendar.ts` is optional and nullable on
  `CalendarEventBaseSchema` and `MilestoneTemplateItemBaseSchema`.
- The resolved country is never stored on the event. It is resolved per row
  every time a count is computed.

How an event gets its value:

| Path | Behaviour |
| --- | --- |
| `createMilestone` / `updateMilestone` | Set explicitly from the event dialog. |
| `applyTemplate` | Copied from the template item, like `phaseId`. The copy happens at generation, so later edits to the item do not reach events already generated. |
| `cloneFromBrandSeason` | Not copied, and neither is `phaseId`: cloned events start at `null`. |

The field is outside the post-freeze lock. On a frozen phase event whose
deadline has passed, only the dates, the title and the phase are locked
(`isEventDateLocked`, enforced by `seasonCalendar.updateMilestone`). The
relevance stays editable, and changing it re-scores both the countdown and any
completion outcome measured against that event.

The resolution reads the following data, all of it pre-existing:

| Data | Source |
| --- | --- |
| Company country | `CompanyProfile.countryCode` (singleton, nullable), read by `resolveCompanyCountryCode`. `company.profile.update` writes it from `address.countryCode`; an update whose address has no country keeps the stored value. |
| Vendor country | `CollectionLayoutRow.vendorId` (nullable) → `Vendor.countryCode` (nullable). The vendor's `isActive` flag is not checked. |
| Holidays | `Holiday` rows: `countryCode`, `startDate`, `endDate`. |

## Relevance options

| Value | UI label | A day counts when it is… |
| --- | --- | --- |
| `null` | "— Nessuna (giorni di calendario) —" | any day (plain calendar days) |
| `COMPANY` | "Calendario aziendale" | a weekday that is not a holiday in the company's country |
| `VENDOR` | "Calendario fornitore" | a weekday that is not a holiday in the row vendor's country |
| `BOTH` | "Entrambi" | a weekday that is a holiday in neither country |

## Country resolution

`resolveDaysCount` resolves the countries per row each time it computes a count,
and never saves them on the event. An event belongs to a planning group, and one
planning group can hold many rows with different vendors, so an event has no
single vendor country of its own.

| Mode | Codes passed to `workingDaysBetween` | Unknown country |
| --- | --- | --- |
| `COMPANY` | `[companyCountry]` | No company country: weekends only. |
| `VENDOR` | `[vendorCountry]` | Row has no vendor, or vendor has no country: weekends only. |
| `BOTH` | `[companyCountry, vendorCountry]`, unknown ones dropped | One missing: the other alone. Both missing: weekends only. |

For "weekends only" the code calls `workingDaysBetween(from, to, [], [])`, which
passes an empty holiday list. It does not pass the fetched holidays with an
empty country list, because `isWorkingDay` reads an empty country list as "apply
every holiday passed, whatever its country", the opposite of what is wanted.

The company code comes first in the list and the vendor code second. The list is
not de-duplicated.

## Counting working days

The count is `workingDaysBetween` in `packages/core/src/utils/dateUtils.ts`,
built on `isWorkingDay`:

- A working day is a Monday to Friday that falls inside no `Holiday` range
  (`startDate` to `endDate`, inclusive) whose `countryCode` is in the list.
- Dates are read in the API process's local time zone.

### Intersection of open days in both

When the list holds more than one country code, `isWorkingDay` excludes any date
that is a holiday in **any** of them. For `BOTH`, that is exactly "a day counts
only if it is open in both calendars", the intersection of the open days, with
no combination logic of its own. For example, take Monday to Friday with a
Chinese holiday on Tuesday and an Italian one on Wednesday: `COMPANY` (IT)
counts 4, `VENDOR` (CN) counts 4 and `BOTH` counts 3.

### Endpoint convention

The two counts do not share an endpoint convention, and the original design did
not address this:

- `daysBetween` (calendar mode) is the difference between two calendar dates. It
  ignores the time of day, and two instants on the same date give 0.
- `workingDaysBetween` (working mode) steps from the earlier instant to the
  later one, one day at a time, and counts every step that lands on a working
  day, **both endpoints included**. The result is negated when the deadline is
  earlier, so the time of day matters.

With now = Monday 10:00 and no holidays:

| Deadline | Calendar mode | Working mode |
| --- | --- | --- |
| Monday, all-day (stored at 00:00 UTC) | 0 | −1 |
| Monday 18:00 | 0 | 1 |
| Tuesday, all-day | 1 | 1 |
| Tuesday 18:00 | 1 | 2 |
| Next Monday, all-day | 7 | 5 |
| Monday, all-day, seen from Tuesday 10:00 | −1 | −2 |

Consequences for an opted-in event:

- The count reaches 0 ("Scade oggi") only when no working day lies between the
  two instants.
- An all-day milestone shows as one working day overdue on its own due date. The
  row enters the default "In ritardo" band, and the row-phase-overdue
  notification fires that same day.
- A row concluded on the due date of an all-day milestone scores as "Concluso in
  ritardo". In calendar mode the same row scores as on time.

No test covers the working-days path. `apps/api/test/phaseAlert.spec.ts` builds
every fixture with `calendarDaysRelevance: null`.

### Where the count is used

`resolveDaysCount` is the single switch between the two modes. Each count uses
the relevance of the event it measures against:

| Count | Between | Relevance of |
| --- | --- | --- |
| `daysToDeadline` | now → active milestone's deadline | active event |
| `nextPhase.daysUntil` | now → next milestone's deadline | next event |
| `daysVsDeadline` (concluded rows) | `completedAt` → last milestone on an active phase | that milestone |

The deadline is always the event's live `endAt ?? startAt` (`eventDeadline`) and
never the frozen baseline. Each result carries `daysMode` (`'calendar'` or
`'working'`) and `relevantCountryCodes`, so that the UI can state the unit. The
next-phase entry carries them too, but the UI does not render its unit.

Alert bands (`collectionControl.alertThresholds`) do not know which unit they
receive: the same `minDaysToDeadline` / `maxDaysToDeadline` bounds classify both
calendar-day and working-day counts.

### Data fetching

The working-days context (company country plus holidays) is fetched only when
something in scope has opted in: the active event, the next event, or, for a
concluded row, its completion event. Otherwise the code uses an empty context
and runs no query. When the context is needed, `buildWorkingDaysContext` builds
it once per request with two reads:

- the company's country;
- one `Holiday` query covering the union of the company country and every vendor
  country in scope. That is the row's vendor for `computeCriticality`, and every
  row's vendor for `computeCriticalityForLayout`.

The holiday query filters by country only, not by date range.

### Downstream effects

The band and `daysToDeadline` both come from this count. An opted-in event
therefore changes the following for the rows it applies to: the criticality
badge, the saturation heatmap, the bottleneck index, and the row-phase-overdue
notification (`checkRowPhaseOverdue`, which fires when `daysToDeadline < 0`).

The calendar milestone notifications in `milestoneDeadlineScheduler.ts` are not
affected. Their "upcoming" window (next 48 hours) and "overdue" window (last 3
days) are wall-clock windows on the event's `startAt`.

## Holiday sources

- **`Holiday` rows are the only holiday input.** An admin imports them on demand
  from the Nager.Date public API, one country and year at a time
  (`holidays.previewImport` / `holidays.confirmImport`, `config:update`). Each
  holiday is stored as a single-day entry with `source: 'nager.date'` and can be
  deleted individually. There is no scheduled sync. The seed creates
  `HolidayCountry` rows (IT, CN, VN, IN, TR) but no holidays. For a country or
  year with nothing imported, the count silently falls back to weekends only.
- **`HolidayCountry.active` is not consulted.** Every `Holiday` row for a
  resolved country code counts.
- **`VendorClosurePeriod` is not an input**, whether a `CLOSURE` period or an
  `OPEN` override. The planning wizard shows vendor closures while events are
  being placed (`useVendorClosures`), but that is a separate concept and the
  deadline math never reads it. A vendor that stays open on a public holiday in
  its country still loses that day.

## UI behaviour

### Choosing the relevance

The only control is `CalendarDaysRelevanceSelect` (`apps/web/src/components/`).
Both `CalendarEventDialog` (calendar) and `TemplateItemDialog` (milestone
template configuration) use it, as a field labelled "Conteggio giorni scadenza"
placed below "Fase". It defaults to "— Nessuna (giorni di calendario) —"; the
other options are "Calendario aziendale", "Calendario fornitore" and "Entrambi".
The template dialog adds "Propagato all'evento generato quando il template viene
applicato al calendario."

Read-only helper text under the select says where the country comes from. The
country itself is never editable:

| Selection | Helper text |
| --- | --- |
| `COMPANY` | "Paese: IT": the company profile's ISO code, or "— non impostato in Impostazioni azienda —". |
| `VENDOR` | "Risolto dal fornitore assegnato a ciascuna riga collezione." Shows no country, because the country differs per row. |
| `BOTH` | "Giorno lavorativo solo se aperto sia in azienda (IT) sia presso il fornitore di ciascuna riga." |

The select stays enabled on events whose dates are locked after freeze. The
read-only event view shows the choice as a badge: "gg lavorativi (azienda)",
"gg lavorativi (fornitore)" or "gg lavorativi (entrambi)".

### Stating the unit

Criticality tooltips state the unit of the number they show. The formatting is
in `CriticalityBadge.tsx`, shared by the row drawer's "Situazione" block and the
collection-layout table cell.

| `daysMode` | Unit label |
| --- | --- |
| `calendar` | "gg di calendario" |
| `working`, countries resolved | "gg lavorativi (IT+CN)", codes joined by "+" |
| `working`, weekends only | "gg lavorativi" |

For example: "12 gg lavorativi (IT+CN) alla scadenza — «title»: date".
Concluded rows use the same unit in "… di anticipo" / "… di ritardo". Because
the code list is not de-duplicated, an Italian vendor under an Italian company
reads "IT+IT" in `BOTH` mode.

Only the tooltip states the unit. The detail line next to the badge ("tra 12
giorni", "5 giorni di ritardo", "Prossima fase: … · tra N giorni") prints the
number as "giorni" in either mode. The next-phase figure also uses the next
event's relevance, which may differ from the badge's.

### Freeze-time warning

When a planning group is frozen, `FreezePlanningGroupWizard` shows a
non-blocking warning for events that land on a non-working day.
`resolveHolidayOverlapsForGroup` computes it with the same country resolution as
the countdown, with these rules:

- It checks only events that are not cancelled, are tagged with a phase and have
  a relevance set.
- It checks the event's `startAt`, not its deadline.
- An event on a weekend is reported once, as "weekend".
- Otherwise, it is flagged "festività azienda" if the day is a company holiday
  (`COMPANY` / `BOTH`).
- It is also flagged "chiusura fornitore «name»" once for each distinct vendor
  country among the group's rows where the day is a holiday (`VENDOR` / `BOTH`).

That vendor label says "chiusura", but the data comes from the `Holiday` table,
not from `VendorClosurePeriod`.

## Changes since the original design

The code differs from the design as first written in these points:

- **Company country helper.** `resolveCompanyCountryCode` lives in
  `apps/api/src/services/companyProfile.service.ts`, where
  `holidays.listCountries` also uses it. The design had it local to the alert
  service.
- **Holiday fetch.** Planned to cover only the relevant date range; it filters
  by country only.
- **Endpoint convention.** Planned as a drop-in swap of `daysBetween` for
  `workingDaysBetween`. The swap also changed how endpoints are counted; see
  [Endpoint convention](#endpoint-convention).
- **Scheduling variance.** Planned to use the same count, and it did in
  `3b4c5176`. The scheduling-variance endpoint and its badge were then removed
  entirely on 2026-07-28 (`e7d5cc6c`).
- **Additional counts.** The next-phase countdown (`8626e842`, 2026-08-01) and
  the concluded-row outcome (`1d7ad8b9`, 2026-08-02) came later and use the same
  rule.
- **Freeze-time warning.** Not in the original design; added in `e7d5cc6c`.
- **Helper text.** Planned to show the resolved country name ("Fornitore:
  Cina", "Azienda: Italia"). It shows the company's ISO code instead, and no
  country at all for `VENDOR`.
- **Tooltip wording.** Planned as "N gg lavorativi (calendario fornitore CN)";
  implemented as "N gg lavorativi (CN)", with codes joined by "+" for `BOTH`.
- **Notifications.** As planned, the scheduler's 48-hour and 3-day windows stay
  in wall-clock time. The row-phase-overdue notification, however, follows the
  working-day count, because it reuses the criticality engine.
- **Schema location.** The models moved out of `apps/api/prisma/schema.prisma`:
  the enum, `CalendarEvent`, `MilestoneTemplateItem` and `Holiday` are now in
  `packages/db/prisma/calendar.prisma`, `Vendor` in `catalog.prisma`,
  `CollectionLayoutRow` in `collection.prisma` and `CompanyProfile` in
  `company.prisma`.
