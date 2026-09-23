# Google Calendar Integration Setup

Luke pushes season-calendar milestones to Google Calendar. The integration is
configured in AppConfig from the **Google Workspace** settings page
(`/settings/google`) by a user with `config:update`; no environment variable
configures it. It supports two authentication modes: a **service account**,
optionally impersonating a Workspace user through domain-wide delegation, or an
**OAuth user** account connected from the settings page. UI labels below are
quoted as they currently appear in the product, which is in Italian.

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

On the **Google Workspace** page, choose the **Service Account** mode and paste
the JSON key file: the page extracts `client_email` and `private_key` from it.
Enter the Workspace domain and, optionally, the user to impersonate; turn on
**Sincronizzazione Google Calendar**; then click **Salva Configurazione**. The
private key is stored encrypted in AppConfig.

## Option B — OAuth user

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth client
   ID of type **Web application**.
2. Add the authorized redirect URI `<web origin>/api/google/oauth/callback`. The
   settings page displays the exact value for the current origin.
3. On the **Google Workspace** page, choose the **OAuth 2.0 — Account utente** mode,
   enter the client ID, the client secret and the Workspace domain, turn on
   **Sincronizzazione Google Calendar**, and click **Salva Configurazione**.
4. Click **Connetti account Google** and complete Google's consent screen. Luke
   requests offline access and stores the resulting refresh token, encrypted,
   together with the connected account's email. **Disconnetti** removes the token.

## Verify

Click **Test Connessione** on the settings page (`integrations.google.testConnection`,
which requires `config:read`). It uses the stored credentials to list one
calendar, and reports either success or what is missing: the domain, the
service-account credentials, or the OAuth connection.

## When the sync runs

The sync runs only when calendar sync is enabled
(`integrations.google.calendarSync.enabled`) **and** the domain and the
credentials of the selected mode are all configured. If any of them is missing,
the sync is skipped without an error. A sync can be started by hand with
`seasonCalendar.triggerSync`, which requires `season_calendar:sync`.

## Architecture

- **Push-only**: Luke writes to Google and never reads events back. The only read
  is the connection test's calendar listing.
- **Calendar ownership** follows the identity Luke authenticates as: the service
  account, the impersonated user, or the connected OAuth account. Luke users are
  added to the calendars as `reader`.
- **One calendar** per brand × season × section, named
  `Luke • {brandCode} • {seasonCode} • {sectionLabel}`.
- **Idempotent sync**: a content hash comparison prevents redundant API calls.
- **Retry**: up to three attempts with exponential backoff (500 ms, then 1 s) on
  429 and 5xx responses; other 4xx responses are not retried.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 forbidden` on calendar ops | Google Calendar API not enabled | Enable Google Calendar API in Cloud Console |
| `401 unauthorized` | Invalid private key or client email, or a revoked OAuth token | Paste the JSON key again on the **Google Workspace** page, or reconnect the OAuth account |
