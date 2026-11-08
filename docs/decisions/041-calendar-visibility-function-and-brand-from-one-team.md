# ADR-041 — Calendar Visibility: Function and Brand from One Team

## Status

Accepted

## Context

[ADR-014](014-calendar-visibility-single-predicate.md) made one predicate decide both which events a user sees and who is notified about them. In its predicate, `P_access` takes the event's brand from any of the user's active teams, and `P_relevance` takes the event's function from any of them. So a user in a team of function F1 scoped to brand A and in a team of function F2 scoped to brand B could see the brand-A events visible to F2, and was notified about them, although none of their teams grants F2 on brand A.

The owner decided on 2026-11-08 that a team grants its function on its own brands only: the function and the brand must come from the same active team. This changes what ADR-014 decides, so it is recorded here, and ADR-014 is superseded.

Three related points had to be stated on the same basis:

- **The whole-brand fallback.** ADR-014 states it as "e has no visibility rows". The read path applied it to events with no *function* rows, the notification path to events with no rows of either kind, so an event shared only with single people reached the whole brand on read and only those people on notify.
- **Admins.** ADR-014 says admins are notified only through their own team membership, "exactly like anyone else", but its notification path took an admin's brand from their unrestricted access and added every admin to the fallback.
- **Calendar exports.** The REST export routes authenticated the caller and filtered by brand and function, but required no permission.

## Decision

One predicate, implemented once in `apps/api/src/services/calendarAudience.service.ts` and exposed in both directions (`eventVisibilityWhere` forward, `resolveEventAudience` reverse):

```
canSee(u, e) = u.isActive ∧ ¬u.pendingApproval ∧ P_access(u, e) ∧ P_relevance(u, e)

P_access    : u.role = 'admin'                                    (brand-unrestricted)
            ∨ e.calendar.brandId ∈ ⋃ { T.brandScopes : T active team of u }

P_relevance : e has no visibility rows of either kind             (whole-brand fallback)
            ∨ ∃ active team T : u ∈ T ∧ T.functionId ∈ e.visibilities
                                ∧ e.calendar.brandId ∈ T.brandScopes
            ∨ ∃ CalendarEventUserVisibility(e, u)                 (per-person exception)
```

1. **A pair comes from one team.** `getUserAllowedIds` (`context.service.ts`) returns, besides the union of brands, the function → brands pairs the user's teams grant (`FunctionBrands`); a team with no brand scope grants its function on nothing. `eventVisibilityWhere` has one arm per function, carrying that function's brands, so it holds for every read and write that composes it: the calendar list, access by id ([ADR-040](040-calendar-events-access-by-id-and-masking-outside-the-calendar.md)), masking, the save confirmation, and the exports. `resolveEventAudience` takes function candidates only from a team holding the function and the event's brand.
2. **The fallback has one definition: no visibility rows of either kind.** An event shared only with single people reaches only them, on read and on notify. To keep the fallback from changing under a share:
   - an event with no visibility row at all takes no per-person row (`grantUserVisibility` answers `PRECONDITION_FAILED`, and the share picker offers nobody); an event already shared only with people takes more;
   - the last per-person row of an event with no function row is not removed: not by `revokeUserVisibility` (under a row lock), nor by the cascade of a user's permanent deletion (`users.hardDelete` refuses);
   - a clone refuses a source event with per-person rows and no function row, since the copy carries function rows only and would reach the whole brand. The refusal names only the events the caller can list, as every clone refusal does.

   `applyTemplate` still creates events with no row at all, which reach the whole brand as before (ADR-014's safety net).
3. **Admins read everything and are notified like anyone else**: through a team holding the pair, a team holding the brand for the fallback, or a per-person row. The manual "send to me" digest stays as it is: it is requested by the admin and shows what they can read, not an automatic fan-out.
4. **A deleted event's digest uses the audience at deletion.** The snapshot `deleteMilestone` stores (`visibleUserIds`) is resolved with this predicate; delivery keeps re-checking brand access.
5. **Calendar exports require `season_calendar:read` and `season_calendar:export`**, checked in `resolveParams` right after authentication (401 without a session, 403 for either missing permission). An export is a read that leaves the app.
6. **The Google Calendar subscribe panel follows the readers' rule**: an admin sees every function's calendar, anyone else one only when a team of theirs holds its function and the calendar's brand, the rule the Google calendar readers follow.

ADR-014's sub-decisions 3 (the per-person grant as the only escape hatch, brand validated at grant time) and 4 (no default team at provisioning) stand unchanged. Its sub-decision 1 is restated in point 3, and its sub-decision 2 (function as access control, the fallback as a safety net) in points 1 and 2.

## Consequences

- **Reads and notifications become narrower** for a user who held a function and a brand only through different teams, and for admins on notifications.
- **An event shared only with single people narrows at once** to those people. Events with no rows at all are unchanged.
- **Snapshot transition.** A deletion snapshot taken before this change, still inside the digest window when it ships, was resolved with ADR-014's predicate; it is delivered as stored, with the brand re-check.
- **An event with no visibility row cannot be shared with a person** until it has a function, and **a user who is the only person of such an event cannot be deleted** until it has one.
- **A role without either export permission can no longer export.** Every built-in role holds both, so nobody loses access.
