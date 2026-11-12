# Google Calendar Integration Setup

Luke pushes season-calendar milestones to Google Calendar. The integration is
configured in AppConfig from the `Google Workspace` settings page
(`/settings/google`) by a user with `config:update`; no environment variable
configures it. It supports two authentication modes: a **service account**,
optionally impersonating a Workspace user through domain-wide delegation, or an
**OAuth user** account connected from the settings page. Luke's own UI labels
below are quoted as code, as they appear in the product, which is in Italian;
Google's are in bold.

## Choosing a mode

Use an **OAuth user** with a mailbox dedicated to Luke (for example
`luke-calendar@<domain>`): Luke then acts on that mailbox only, and the calendars
it creates belong to it. A service account that impersonates a user needs
domain-wide delegation, and delegation cannot be limited to one mailbox: it grants
the Calendar scope for every user of the domain to whoever holds the key. Without
it, impersonating a user fails with `unauthorized_client`. A service account
without impersonation needs no delegation, but the calendars then belong to the
service account, outside the Workspace.

Choose the identity before the first sync. Calendars belong to the identity that
created them: after a switch of mode, account or impersonated user, the new
identity cannot write to the calendars created under the previous one, so the sync
of their events fails, and Luke cannot move them.

## Prerequisites

- Google Cloud project with billing enabled
- The Google Workspace domain the calendars belong to
- Admin access to the Google Workspace domain, if you use domain-wide delegation

In both modes, enable the API first: Google Cloud Console → APIs & Services →
Library → search for **Google Calendar API** → Enable.

## Option A — Service account

### 1. Create a service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts
2. Click **Create Service Account**
   - Name: `luke-calendar-sync`
   - Description: `Luke season calendar Google sync`
3. Click **Create and Continue** → skip optional roles → **Done**

### 2. Generate a JSON key

1. Click the service account → **Keys** tab → **Add Key** → **Create new key** → JSON
2. Download the JSON file. Keep it secure and never commit it.

### 3. Configure domain-wide delegation (optional)

Required only when Luke should act as a Workspace user rather than as the service
account itself — that is, when you set an email to impersonate in step 4.

1. Google Admin Console → Security → API Controls → Domain-wide Delegation
2. Add the service account's **Client ID** with scope:
   ```
   https://www.googleapis.com/auth/calendar
   ```

### 4. Configure Luke

On the `Google Workspace` page, choose the `Service Account (tecnico)` mode and paste
the JSON key file: the page extracts `client_email` and `private_key` from it.
Enter the Workspace domain and, optionally, the user to impersonate; turn on
`Sincronizzazione Google Calendar`; then click `Salva Configurazione`. The
private key is stored encrypted in AppConfig.

## Option B — OAuth user

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth client
   ID of type **Web application**.
2. Add the authorized redirect URI `<web origin>/api/google/oauth/callback`. The
   settings page displays the exact value for the current origin.
3. On the `Google Workspace` page, choose the `Account utente OAuth (collega virtuale)` mode,
   enter the client ID, the client secret and the Workspace domain, turn on
   `Sincronizzazione Google Calendar`, and click `Salva Configurazione`.
4. Click `Connetti account Google` and complete Google's consent screen. Luke
   requests offline access and stores the resulting refresh token, encrypted,
   together with the connected account's email. `Disconnetti` removes the token.

## Verify

Click `Test Connessione` on the settings page (`integrations.google.testConnection`,
which requires `config:read`). It uses the stored credentials to list one
calendar, and reports either success or what is missing: the domain, the
service-account credentials, or the OAuth connection. The test and the sync
authenticate the same way, impersonation included: a test that fails with
`unauthorized_client` means the sync fails too.

Once a sync has run, the `Stato sincronizzazione` block on the same page shows,
for each operation (`Sincronizzazione eventi`, `Lettori dei calendari`,
`Eliminazioni`), the time of its last success and of its last failure, with the
failure's message; a stored credential Luke cannot read counts as a failure too.
An operation that has neither failed nor sent Google a request is not listed: a
sync with nothing to change sends none. A failure also notifies the
administrators in the app, at most once every 6 hours per operation, with a link
to this page.

## When the sync runs

The sync runs only when calendar sync is enabled
(`integrations.google.calendarSync.enabled`) **and** the domain and the
credentials of the selected mode are all configured. If any of them is missing,
the sync is skipped without an error. An event is synced when it is created,
edited, rescheduled, cancelled or restored; an event left behind (created while
the sync was off or failing) reaches Google on its next change, or when a sync is
started by hand: `Altre azioni` › `Sincronizza` on the calendar page
(`seasonCalendar.triggerSync`, which requires `season_calendar:sync`) syncs every
event of the brand and season selected in the header.

## Architecture

- **Push-only for events**: Luke writes events to Google and never reads them
  back. It does read calendar permissions: the sync lists each calendar's access
  rules to keep its readers in step, and reads the domain rule to restrict it.
- **Calendar ownership** follows the identity Luke authenticates as: the service
  account, the impersonated user, or the connected OAuth account. Readers are the
  active administrators plus the active members of an active team that holds both
  the calendar's company function and its brand; users pending approval read
  nothing. They are added as `reader`, and Google emails each new reader that the
  calendar was shared with them; a pass that changes nothing sends nothing. A domain-wide
  rule is downgraded to `freeBusyReader`.
- **Reader reconcile**: the API brings every provisioned calendar's readers back
  to that rule 30 seconds after it starts and then every 10 minutes, whenever
  Google credentials are configured, even with event sync turned off. A change in
  Luke (a member leaving a team, a team losing a brand or being deactivated, a user
  deactivated or with a new address) reaches Google within 10 minutes.
  `db:harden-google-acl` runs one pass immediately. Luke changes only user-scoped
  `reader` rules: any other rule (a group, another domain, public access, a
  `writer`, a second owner) is left as it is and reported in the API log, for the
  Workspace admin to review. A Luke address that is an alias of a Google account
  already reading the calendar (Google lists the account's primary address) is
  recognised and not added again. If the same address is added on two passes in a
  row, Google did not keep it: the API log warns and the sync status shows a
  `Lettori dei calendari` failure.
- **Deleting a purged calendar** also needs only the credentials. A calendar Google
  refuses to delete is logged by id, recorded as an `Eliminazioni` failure, and
  keeps its sharing until removed by hand. A calendar or event already gone from
  Google, deleted there by hand for example, counts as deleted: here, and when the
  sync removes an event (unpublished, or a function taken off its visibility). An
  event in a calendar Luke can no longer reach (another identity owns it) is not:
  that removal is recorded as a failure.
- **An event deleted by hand on Google** comes back the next time it changes in
  Luke: Luke is the source of truth for what it publishes.
- **One calendar** per season calendar (brand × season) and company function,
  named `Luke • {brandCode} • {seasonCode} • {function name}`.
- **Idempotent sync**: a content hash comparison prevents redundant API calls.
- **Retry**: up to three attempts with exponential backoff (500 ms, then 1 s) on
  network errors, 5xx, 429 and rate-limit 403 responses; other 4xx responses are
  not retried.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 forbidden` on calendar ops | Google Calendar API not enabled | Enable Google Calendar API in Cloud Console |
| `401 unauthorized` | Invalid private key or client email, or a revoked OAuth token | Paste the JSON key again on the `Google Workspace` page, or reconnect the OAuth account |
| `unauthorized_client` | The service account impersonates a user without domain-wide delegation for the Calendar scope | Move to an OAuth user with a dedicated mailbox ([Choosing a mode](#choosing-a-mode)), or add the delegation (option A, step 3) |
