# @luke/calendar

<!-- luke-docs:start:overview -->
Google Calendar integration for Luke's season calendars: the authenticated Google client, calendar and ACL provisioning, the idempotent milestone sync engine, and the iCal (`.ics`) feed generator. The synchronisation is one-way — Luke milestones are pushed to Google, nothing is ever read back into Luke.

Google Cloud project, service account and Workspace configuration: [`docs/google-calendar-setup.md`](../../docs/google-calendar-setup.md).
<!-- luke-docs:end:overview -->

## Used By

<!-- luke-docs:start:dependents -->
- `@luke/api` (`apps/api`) — the `integrations.google.*` router (connection test and OAuth authorization flow), `services/googleCalendarSync.service.ts` (which builds the `SyncContext` over Prisma and is called from the `seasonCalendar.*` router), the `GET /download/season-calendar/ical` export route, and the `harden-google-calendar-acl` maintenance script

`apps/web` does not depend on this package: it reaches the same functionality through tRPC and the download route.
<!-- luke-docs:end:dependents -->

## Main Exports

<!-- luke-docs:start:exports -->
### Client and OAuth

| Symbol | Type | Description |
|--------|------|-------------|
| `createGoogleCalendarClient(config)` | function | Initialises the per-process singleton client from a `CalendarConfig` — Workspace service account, with optional impersonation, or a user OAuth refresh token. Every other Google call in the package resolves the client through it |
| `testGoogleConnection(config)` | function | Validates a configuration by listing one calendar on a throwaway client, leaving the singleton untouched; returns `{ ok: true }` or `{ ok: false, error }` instead of throwing |
| `generateOAuthUrl(clientId, clientSecret, redirectUri, state)` | function | Builds the Google consent URL with `access_type=offline` and `prompt=consent`, so a refresh token is returned every time, and carries the flow's `state`, which Google returns with the code |
| `exchangeOAuthCode(clientId, clientSecret, redirectUri, code)` | function | Exchanges the authorization code for a refresh token and the authenticated account's email (`null` when Google's answer has none); throws `MissingRefreshTokenError` when Google returns no refresh token |
| `MissingRefreshTokenError` | class | Thrown by `exchangeOAuthCode` when Google's answer carries no refresh token; the account has to be authorized again with consent |

### Calendars and ACL

| Symbol | Type | Description |
|--------|------|-------------|
| `buildCalendarSummary(brandCode, seasonCode, sectionLabel)` | function | Composes the calendar display name — `Luke • {brand} • {season} • {section}` |
| `createCalendar(summary, description?)` / `deleteCalendar(id)` | function | Creates a Google Calendar, returning `{ id, summary }` and throwing when the API returns no id, and permanently deletes one |
| `syncCalendarAcl(id, expectedEmails)` | function | Brings the calendar's ACL to what Luke grants from one read of every ACL page: the user-scoped `reader` rules become exactly `expectedEmails` (addresses compared ignoring case, a rule removed by its Google id; an expected reader who already holds a user `writer` or `owner` rule is left as is) and the Workspace `domain:` rule is pinned to `freeBusyReader`. Each reader change runs on its own, so one refusal does not stop the rest; a refused domain downgrade is thrown. Returns `AclSyncResult` — counts, the refused changes, and the rules it does not manage (see Key Concepts) |
| `googleErrorStatus(err)` | function | HTTP status of a Google API error, `undefined` for a network error |

### Events

| Symbol | Type | Description |
|--------|------|-------------|
| `createEvent(calendarId, input)` | function | Creates an event from an `EventInput` and returns its Google event id |
| `updateEvent(calendarId, eventId, input)` | function | Replaces the whole event body — this is an `events.update`, not a patch |
| `deleteEvent(calendarId, eventId)` | function | Deletes an event; idempotent on a 410, so a re-run over an already-removed event succeeds |

### Sync engine

| Symbol | Type | Description |
|--------|------|-------------|
| `syncMilestone(milestone, ctx)` | function | Reconciles one milestone across every calendar named in `visibilityFunctionIds`: creates, updates in place, skips on an unchanged content hash, and deletes the events of functions that left the list or of a milestone no longer published externally |
| `computeContentHash(milestone)` | function | First 32 hex characters of a SHA-256 over the fields that reach the Google event, with `visibilityFunctionIds` sorted so the hash does not move with array order |

### iCal

| Symbol | Type | Description |
|--------|------|-------------|
| `generateIcal(milestones, calendarName, prodId?)` | function | Renders an RFC 5545 `.ics` feed from `ICalMilestone[]` — all-day events as plain dates with the exclusive `DTEND` (the day after the last day), timed events in UTC, a cancelled milestone as `STATUS:CANCELLED` |

### Types

| Symbol | Type | Description |
|--------|------|-------------|
| `CalendarConfig` | type | Discriminated union on `mode`: `service_account` (email, private key, optional impersonation) or `oauth_user` (client id, secret, refresh token) — both carrying `workspaceDomain` |
| `GoogleCalendarClient` | type | Alias for the googleapis `calendar_v3.Calendar` instance |
| `EventInput` | type | The event body the package writes: title, optional description, `startAt`/`endAt`, `allDay`, and `confirmed` \| `cancelled` |
| `MilestoneForSync` | type | The milestone fields the engine needs — including `publishExternally`, `visibilityFunctionIds` and `planningGroupName`, whose initials prefix the Google event title |
| `SyncContext` | type | Every database read and write the engine performs, injected as callbacks: `getOrCreateBinding`, `getMappings`, `upsertMapping`, `deleteMapping`, plus the brand and season codes |
| `GoogleCalendarBindingRecord` / `GoogleEventMappingRecord` | type | The persisted section → calendar binding, and the per-function milestone → event mapping that carries the stored `contentHash` |
| `ICalMilestone` | type | The narrower milestone shape the iCal generator consumes |
<!-- luke-docs:end:exports -->

## Key Concepts

<!-- luke-docs:start:concepts -->
- **Nothing is imported from `apps/api`, and nothing from Prisma.** The only workspace dependency is `@luke/core`; the runtime dependencies are `googleapis` and `ical-generator`. Every database read and write the sync engine needs arrives as a callback on `SyncContext`, which is what keeps the engine pure and unit-testable without a database.
- **The client is a per-process singleton, and it must be initialised first.** `createGoogleCalendarClient` stores the configuration and every other function resolves the client through an internal `getClient()` that throws when it was never called. Calling it again replaces the active client, which is how `apps/api` swaps configuration: it re-reads the `integrations.google.*` AppConfig keys and re-initialises at the start of each sync run.
- **Idempotence comes from a stored content hash, not from reading Google back.** `syncMilestone` compares `computeContentHash(milestone)` against the hash saved on the mapping and skips the calendar entirely when they match, so a re-run costs no Google write. The hash covers the group-initials prefix actually rendered into the title, so renaming a planning group is a real change and does re-sync.
- **One calendar per company function, one mapping per milestone and function.** A milestone fans out to every calendar in `visibilityFunctionIds`, and the binding for a function is provisioned on first use. Dropping a function from that list is a deletion: the run removes the Google event and the mapping for it, exactly as setting `publishExternally` to false does.
- **The domain ACL rule has to be pinned down explicitly.** Google auto-creates a `domain:<workspaceDomain>` rule on every calendar made inside a Workspace, inherited from the org's default sharing setting, and Google applies the *most permissive* rule matching a user — so an org default of "edit" would silently override the per-user `reader` grants. `syncCalendarAcl` downgrades it to `freeBusyReader` on every call, at provisioning and on every reader reconcile; nothing changes when no domain rule exists or it is already read-only.
- **Luke manages only user-scoped `reader` rules** (and pins the domain rule). `syncCalendarAcl` never changes any other rule; it returns them in `unmanaged` for the caller to report, and leaves removing access Luke never granted to the Workspace admin. Which rules count is documented on `unmanagedRules` in `src/google/acl.ts`.
- **Retries are bounded and skip client errors.** Every Google call in `syncMilestone` and in the ACL functions runs through `withRetry`: three attempts with exponential back-off (500 ms, 1 s) on network errors, 5xx, 429 and a 403 whose reason is a rate limit. Any other 4xx is rethrown immediately — a rejected request will not become valid by being sent again.
<!-- luke-docs:end:concepts -->

## Usage Example

<!-- luke-docs:start:example -->
```typescript
import {
  createGoogleCalendarClient,
  generateIcal,
  syncMilestone,
  type CalendarConfig,
  type MilestoneForSync,
  type SyncContext,
} from '@luke/calendar';

/**
 * Publishes one milestone to every Google Calendar its visibility list names,
 * then renders the same milestone as a downloadable iCal feed.
 */
export async function publishMilestone(
  config: CalendarConfig,
  milestone: MilestoneForSync,
  ctx: SyncContext,
): Promise<string> {
  // The singleton has to exist before any Google call. apps/api builds `config`
  // from the `integrations.google.*` AppConfig keys on every sync run.
  createGoogleCalendarClient(config);

  // Fans out over milestone.visibilityFunctionIds: a no-op wherever the stored
  // content hash still matches, a delete wherever the function has dropped out.
  await syncMilestone(milestone, ctx);

  return generateIcal(
    [{ ...milestone, brandCode: ctx.brandCode }],
    `Luke · ${ctx.brandCode} · ${ctx.seasonCode}`,
  );
}
```
<!-- luke-docs:end:example -->
