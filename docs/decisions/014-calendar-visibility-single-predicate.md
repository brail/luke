# ADR-014 — Calendar Visibility: a Single Predicate for Read and Notify

## Status

Accepted

## Context

The calendar recap email was reaching users outside the team it should have — a same-function
teammate scoped to a different brand received every brand's recap. Tracing the bug surfaced that
it wasn't a local mistake but a structural one: **"who can see an event" (read) and "who gets
notified about an event" (notify) were two independently hand-written models**, and they had
already diverged.

- The notify path (`getVisibleUserIdsForMilestones`, the pre-existing resolver) expanded
  `functionId` → every active team with that function → every member, without ever checking the
  team's brand scope against the event's calendar. It also unconditionally unioned in every active
  admin (digest and in-app notifications alike) and always included the acting user — two more
  additive special cases layered on top of the brand-unaware core.
- The read path (`listMilestonesDb`) filtered strictly by brand and treated function as a
  **client-side UI filter chip only** — `CalendarEventVisibility` rows existed in the schema but
  had zero enforcement on what `seasonCalendar.listMilestones` actually returned. A user could be
  notified about an event they could not see, and could see events on their brand regardless of
  which function they belonged to.

No single fix at the notify layer would have closed this gap — the read layer had never encoded
function-based access at all, so "notify ⊆ read" was unstatable as an invariant until both sides
agreed on the same rule.

## Decision

One predicate, implemented once, exposed in both directions:

```
canSee(u, e) = u.isActive ∧ ¬u.pendingApproval ∧ P_access(u, e) ∧ P_relevance(u, e)

P_access    : u.role = 'admin'                                   (brand-unrestricted)
            ∨ e.calendar.brandId ∈ ⋃ { T.brandScopes : T active team of u }

P_relevance : e has no visibility rows                            (permissive fallback)
            ∨ ∃ active team T : u ∈ T ∧ T.functionId ∈ e.visibilities
            ∨ ∃ CalendarEventUserVisibility(e, u)                 (per-person exception)
```

Both live in `apps/api/src/services/calendarAudience.service.ts`:

- **Reverse** (who gets notified): `resolveEventAudience(eventIds)` — used by the digest scheduler,
  in-app calendar notifications, and milestone-deadline alerts.
- **Forward** (what a user sees): `eventVisibilityWhere(userId, functionIds)` — a Prisma `where`
  fragment composed into `listMilestonesDb`, and therefore into the calendar page, iCal, PDF, and
  XLSX exports alike.

Four sub-decisions fell out of unifying the two directions:

1. **No automatic admin fan-out, in any channel.** Admins are `P_access`-unrestricted (they can
   read any brand) but are only `P_relevant` — and therefore only notified — through their own
   team membership, exactly like anyone else. Read and notify are deliberately **not** symmetric
   for admins: unrestricted read, no automatic notify. Tested explicitly as an invariant, not left
   as an implicit consequence.
2. **Function becomes real access control on the read path**, not just a display filter. An event
   with zero visibility rows falls back to "visible to the whole brand" — a safety net against
   orphans produced by `applyTemplate`/`cloneFromBrandSeason` when a template item or source event
   has no function assigned, logged as a warning rather than blocked.
3. **The per-user grant (`CalendarEventUserVisibility`) is the only escape hatch** for sharing an
   event outside its visible functions, without widening those functions or moving someone to a
   different team. Brand access is validated at grant time (`grantUserVisibility`), so the escape
   hatch can never promise access the read path won't actually show. A picker UI
   (`CalendarEventShareSection`) was added — before this change the grant existed in the API with
   no caller and no observable effect on read, so a UI for it would have lied.
4. **`auth.provisioning.defaultTeamId` was removed.** A newly-provisioned LDAP user is created with
   no team at all; `users.approvePending` now requires an explicit `teamId`, assigned in the same
   transaction that clears `pendingApproval`. With function now gating read access, a config key
   silently deciding a new user's team — and therefore their calendar visibility — was no longer an
   acceptable default; the approval step already puts a human in the loop for this exact decision.

## Consequences

- **Digest and in-app notifications became strictly narrower.** A teammate on the same function but
  a different brand no longer receives another brand's recap — the fix the whole redesign started
  from.
- **The calendar (and its exports) became strictly narrower too**, for any user whose team doesn't
  cover a given event's function. This is a real behavior change, not just a bugfix, and required a
  data audit before deploy: any company function with zero event coverage would leave affected
  users looking at an empty calendar. Verified against the seeded dataset before shipping; must be
  re-verified against production data before this reaches it.
- **`users.approvePending`'s tRPC contract is now breaking** (`{ id }` → `{ id, teamId }`) — any
  caller or test invoking it with the old shape fails to compile.
- **The permissive fallback (no visibility rows → whole brand) is a safety net, not a feature.**
  `applyTemplate`/`cloneFromBrandSeason` log a warning when they produce an orphaned event; the
  event stays visible rather than silently disappearing, but the warning is the signal that a
  template item or source event is missing its function assignment.
- **A pre-existing, unrelated brand-scope UI bug was found and fixed as a byproduct**:
  `TeamDialog.tsx`/`TeamList.tsx` displayed "0 brand scope → access to all brands," which
  contradicted the actual (and older) opt-in policy in `getUserAllowedBrandIds`
  (`apps/api/src/services/context.service.ts` — see also `brandScope.service.ts`'s own header
  comment on the historical admin-FORBIDDEN incident that policy exists to prevent). That policy
  itself predates this ADR and isn't a decision made here — only the UI copy was corrected to stop
  contradicting it.
- **A follow-up internal refactor** consolidated `resolveBrandAccess`
  (`calendarAudience.service.ts`) and `getUserAllowedBrandIds`/`getUserAllowedFunctionIds`
  (`context.service.ts`) — two independently hand-written traversals of the same
  `companyTeamMembership → team → brandScopes` shape — behind one shared primitive
  (`getUserAllowedIds`) and one per-request memoization slot on the tRPC `Context`. That refactor
  changed no observable behavior (verified by the full existing test suite passing unmodified) and
  is not itself a decision — it's recorded here only as a pointer, since it touches the same files.
