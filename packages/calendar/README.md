# @luke/calendar

<!-- luke-docs:start:overview -->
Google Calendar integration for Luke's season calendars: the authenticated Google client, calendar and ACL provisioning, the idempotent milestone sync engine, and the iCal (`.ics`) feed generator. The synchronisation is one-way — Luke milestones are pushed to Google, nothing is ever read back into Luke.

Google Cloud project, service account and Workspace configuration: [`docs/google-calendar-setup.md`](../../docs/google-calendar-setup.md).
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- `@luke/api` (`apps/api`) — the `integrations.google.*` router (connection test and OAuth authorization flow), `services/googleCalendarSync.service.ts` (which builds the `SyncContext` over Prisma and is called from the `seasonCalendar.*` router), the `GET /download/season-calendar/ical` export route, and the `harden-google-calendar-acl` maintenance script

`apps/web` does not depend on this package: it reaches the same functionality through tRPC and the download route.
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
### Client and OAuth

| Symbol | Type | Description |
|--------|------|-------------|
| `createGoogleCalendarClient(config)` | function | Initialises the per-process singleton client from a `CalendarConfig` — Workspace service account, with optional impersonation, or a user OAuth refresh token. Every other Google call in the package resolves the client through it |
| `testGoogleConnection(config)` | function | Validates a configuration by listing one calendar on a throwaway client, leaving the singleton untouched; returns `{ ok: true }` or `{ ok: false, error }` instead of throwing |
| `generateOAuthUrl(clientId, clientSecret, redirectUri)` | function | Builds the Google consent URL with `access_type=offline` and `prompt=consent`, so a refresh token is returned every time |
| `exchangeOAuthCode(clientId, clientSecret, redirectUri, code)` | function | Exchanges the authorization code for a refresh token and the authenticated account's email; throws when Google returns no refresh token |

### Calendars and ACL

| Symbol | Type | Description |
|--------|------|-------------|
| `buildCalendarSummary(brandCode, seasonCode, sectionLabel)` | function | Composes the calendar display name — `Luke • {brand} • {season} • {section}` |
| `createCalendar(summary, description?)` / `deleteCalendar(id)` | function | Creates a Google Calendar, returning `{ id, summary }` and throwing when the API returns no id, and permanently deletes one |
| `addCalendarReader(id, email)` / `removeCalendarReader(id, email)` | function | Grants and revokes a single `reader` ACL rule; the removal is idempotent on a 404 |
| `syncCalendarReaders(id, expectedEmails)` | function | Reconciles the reader ACL to exactly `expectedEmails`, issuing the additions and removals in parallel |
| `enforceDomainReadOnly(id)` | function | Pins the Workspace-inherited `domain:` rule down to `freeBusyReader` — see Key Concepts |

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
| `provisionBinding(ctx, companyFunctionId, functionLabel?)` | function | Creates the calendar for one company function, sets its reader ACL from `ctx.getAllowedEmailsForFunction`, pins the domain rule read-only, and returns the new calendar id |
| `computeContentHash(milestone)` | function | First 32 hex characters of a SHA-256 over the fields that reach the Google event, with `visibilityFunctionIds` sorted so the hash does not move with array order |

### iCal

| Symbol | Type | Description |
|--------|------|-------------|
| `generateIcal(milestones, calendarName, prodId?)` | function | Renders an RFC 5545 `.ics` feed from `ICalMilestone[]` — all-day events as plain dates, timed events in UTC, a cancelled milestone as `STATUS:CANCELLED` |

### Types

| Symbol | Type | Description |
|--------|------|-------------|
| `CalendarConfig` | type | Discriminated union on `mode`: `service_account` (email, private key, optional impersonation) or `oauth_user` (client id, secret, refresh token) — both carrying `workspaceDomain` |
| `GoogleCalendarClient` | type | Alias for the googleapis `calendar_v3.Calendar` instance |
| `EventInput` | type | The event body the package writes: title, optional description, `startAt`/`endAt`, `allDay`, and `confirmed` \| `cancelled` |
| `MilestoneForSync` | type | The milestone fields the engine needs — including `publishExternally`, `visibilityFunctionIds` and `planningGroupName`, whose initials prefix the Google event title |
| `SyncContext` | type | Every database read and write the engine performs, injected as callbacks: `getOrCreateBinding`, `getMappings`, `upsertMapping`, `deleteMapping`, `getAllowedEmailsForFunction`, plus the brand and season codes |
| `GoogleCalendarBindingRecord` / `GoogleEventMappingRecord` | type | The persisted section → calendar binding, and the per-function milestone → event mapping that carries the stored `contentHash` |
| `ICalMilestone` | type | The narrower milestone shape the iCal generator consumes |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **Nothing is imported from `apps/api`, and nothing from Prisma.** The only workspace dependency is `@luke/core`; the runtime dependencies are `googleapis` and `ical-generator`. Every database read and write the sync engine needs arrives as a callback on `SyncContext`, which is what keeps the engine pure and unit-testable without a database.
- **The client is a per-process singleton, and it must be initialised first.** `createGoogleCalendarClient` stores the configuration and every other function resolves the client through an internal `getClient()` that throws when it was never called. Calling it again replaces the active client, which is how `apps/api` swaps configuration: it re-reads the `integrations.google.*` AppConfig keys and re-initialises at the start of each sync run.
- **Idempotence comes from a stored content hash, not from reading Google back.** `syncMilestone` compares `computeContentHash(milestone)` against the hash saved on the mapping and skips the calendar entirely when they match, so a re-run costs no Google write. The hash covers the group-initials prefix actually rendered into the title, so renaming a planning group is a real change and does re-sync.
- **One calendar per company function, one mapping per milestone and function.** A milestone fans out to every calendar in `visibilityFunctionIds`, and the binding for a function is provisioned on first use. Dropping a function from that list is a deletion: the run removes the Google event and the mapping for it, exactly as setting `publishExternally` to false does.
- **The domain ACL rule has to be pinned down explicitly.** Google auto-creates a `domain:<workspaceDomain>` rule on every calendar made inside a Workspace, inherited from the org's default sharing setting, and Google applies the *most permissive* rule matching a user — so an org default of "edit" would silently override the per-user `reader` grants. `provisionBinding` calls `enforceDomainReadOnly` after setting the readers for that reason; it is a no-op when no domain rule exists or it is already read-only.
- **Retries are bounded and skip client errors.** Every Google call inside `syncMilestone` runs through three attempts with exponential back-off (500 ms, 1 s), and a 4xx other than 429 is rethrown immediately rather than retried — a rejected request will not become valid by being sent again.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

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
