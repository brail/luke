# ADR-040 — Calendar Events: Access by Id and Masking Outside the Calendar

## Status

Accepted

## Context

[ADR-014](014-calendar-visibility-single-predicate.md) made one predicate the answer to who is notified about an event and which events a user sees, and composed the second, `eventVisibilityWhere`, into `listMilestonesDb`. It decided those two directions and left two other kinds of path as they were:

- Procedures that take an event id checked the brand of the event, not its visibility, so a user could read or write by id an event the calendar did not list to them.
- Outputs outside the calendar named or dated events too: the criticality and bottleneck answers of the alert engine, the note and event reference of automatic revisions, the answers and refusals of a template application or a clone, and the holiday warning before a freeze.

The owner decided on 2026-10-19, on issue #112, that an event the caller cannot list cannot be read or written by id either. Requiring the predicate on writes and on these outputs extends what ADR-014 requires, so it is recorded here rather than as an erratum there. ADR-014 stands.

The engine cannot simply be filtered. `lib/milestoneDeadlineScheduler.ts` measures rows against every event, `collectionLayout.rows.setCompleted` lists the phases a row skips from every event, and a row's band must not depend on who asks.

## Decision

### Access by id

`resolveEventBrandAccess`, the resolver of the procedures that act on one event, checks the brand first and then `assertEventsVisible`. Within an allowed brand, an event the caller cannot list answers `NOT_FOUND` `Evento non trovato`, the same as an id that does not exist, before anything about its state. A brand outside the caller's scope stays `FORBIDDEN`. `locate` keeps its own answer, `NOT_FOUND` for a hidden event and for another brand alike, because it must not tell that an event exists.

`season_calendar:update` therefore no longer guarantees a write inside an allowed brand: visibility applies to writes as to reads, personal notes and shares included. `callerEventVisibility` is the predicate for a request's caller; it is composed with `AND: [fragment]`, so that it cannot overwrite a key of the `where` it joins.

`deleteMilestones` makes the same two checks itself, all or nothing: a hidden event among the ids answers `NOT_FOUND` and deletes nothing, because dropping it silently would report a delete the caller did not get. An id that does not exist is still ignored, so a repeated request stays harmless. A caller who already holds the id of an event in an allowed brand can therefore tell hidden from missing here; event ids are random UUIDs.

### Masking at the response boundary

The engine stays viewer-independent, and `services/eventMasking.service.ts` applies the caller's visibility to what leaves the API. One query resolves visibility for the whole answer, and none for an admin, who sees every event.

- **Criticality.** For a hidden event the identity, dates, day counts and the way days are counted go, each for its own event: active, next or completion. The row keeps its `state` and `band`. A concluded row says `eventHidden`, which separates a hidden milestone from no milestone. The web shows `Evento riservato`.
- **Bottleneck.** Hidden events merge into one last entry with summed band counts, which gives neither how many they are nor their order.
- **Revisions.** An automatic revision's note and event reference go when the caller cannot list the event, in the revision pages and both exports. A deleted event has no visibility left to check, so only an admin still reads them. A manual revision's note is its author's. Stored data is not changed.
- **Template application and clone.** Both still create every event, keeping its visibility. Their answers hold only the events the caller can list, and their refusals name no other.
- **Holiday warning before a freeze.** A freeze snapshots every event of the group: freezing only the visible ones would leave half a baseline. The answer holds the entries the caller can read and `hiddenCount`, the distinct other events flagged. Every holder of `season_calendar:read` receives the count, not only those who can freeze: the wizard is the only reader, and a count names no event.

### What stays visible

These are accepted by kind, each smaller than the workflow it would break:

- A row's `state`, `band` and `reached`, a concluded row's `late` and `completedDay`, and a hidden event's `phaseId` and `nextPhase.reached`. Two rows concluded on close days can bound a hidden deadline.
- Phase labels in `completionPreview` and in the conflict of `rows.setCompleted`, which come from the phase catalog.
- `seasonPhaseOrder`, computed from hidden events too: making it viewer-dependent would break the shared column sort.
- A masked revision's `createdAt`, `cause` and `revisionTypeValue`, which date a hidden event roughly.
- The template catalog: `listTemplates` shows every item, with its title, offset and visibilities, to a holder of `milestone_template:read`. A template is a catalog with its own permission, not an event.
- Counts and refusals that reveal that hidden events exist without naming them: the total in calendar notifications, a planning group's event count and freeze state, and refusals over events in use such as the conflict of `applyTemplate` on a group that has events.

### System paths

The deadline scheduler and notifications read every event. They answer to no caller, and what they send follows `resolveEventAudience` (ADR-014). `rows.setCompleted` reads every event too, and answers its caller with phase labels only.

## Consequences

- A new output that names or dates an event goes through `eventMasking.service.ts`; the engine does not take a viewer.
- Masking fails open for a field added to the engine, so `criticalityForRow`'s masked answers are asserted whole in `apps/api/test/eventMasking.integration.spec.ts`: a new field fails there until someone decides it. The other masked answers are asserted by field.
- Each access by id costs one more query, also for an admin. Merging it into the first would answer `NOT_FOUND` for another brand.
- The check precedes the write without a lock, as the brand check does: a visibility change committed between the two lets that write through. This is a deliberate exception to the check-then-act rule (`CLAUDE.md`, Development Patterns rule 3): the window is short, and the caller had the access when the request began.
- `FORBIDDEN` for another brand still tells that an event exists; `locate` avoids the brand resolvers for that reason.
- Operations by planning group, such as a freeze, act on events the caller may not see. That is by design: they act on the group.
