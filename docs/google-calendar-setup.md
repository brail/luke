# Google Calendar Integration Setup

## Prerequisites

- Google Cloud project with billing enabled
- Admin access to the Google Workspace domain

## Steps

### 1. Create a Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts
2. Click **Create Service Account**
   - Name: `luke-calendar-sync`
   - Description: `Luke season calendar Google sync`
3. Click **Create and Continue** → skip optional roles → **Done**

### 2. Enable Google Calendar API

1. Go to APIs & Services → Library
2. Search for **Google Calendar API** → Enable

### 3. Generate a JSON Key

1. Click the service account → **Keys** tab → **Add Key** → **Create new key** → JSON
2. Download the JSON file (keep it secure — do not commit)
3. Extract values:
   ```
   client_email  → GOOGLE_SA_CLIENT_EMAIL
   private_key   → GOOGLE_SA_PRIVATE_KEY  (full PEM including \n)
   ```

### 4. Configure Domain-Wide Delegation (optional)

Required if the service account needs to act as individual users.

1. Google Admin Console → Security → API Controls → Domain-wide Delegation
2. Add the service account's **Client ID** with scope:
   ```
   https://www.googleapis.com/auth/calendar
   ```

### 5. Set Environment Variables

Add to the API `.env` file (or your deployment secrets):

```env
GOOGLE_SA_CLIENT_EMAIL=luke-calendar-sync@your-project.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
GOOGLE_WORKSPACE_DOMAIN=yourdomain.com
```

> **Note:** `GOOGLE_SA_PRIVATE_KEY` is whitelisted in `assertEnvPolicy` as infrastructure bootstrap.
> The value should be the raw PEM string with literal `\n` newlines.

### 6. Verify

```bash
curl http://localhost:3001/health/google-calendar
```

Expected response:
```json
{ "status": "ok", "calendarsAccessible": true }
```

## Architecture

- **Single source of truth**: Luke → Google (push-only, never pull)
- **Service account** owns all calendars; user emails added as `reader`
- **1 Google Calendar** per `(brand × season × section)` — named `Luke • {brand} • {season} • {section}`
- **Idempotent sync**: content hash comparison prevents redundant API calls
- **Retry**: exponential backoff on 429/5xx, max 3 attempts; 4xx not retried

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 forbidden` on calendar ops | Service account lacks Calendar API | Enable Google Calendar API in Cloud Console |
| `401 unauthorized` | Invalid private key or client email | Verify env vars match JSON key file |
| Events duplicated | Duplicate `GoogleEventMapping` rows | Run `triggerSync` to reconcile |
