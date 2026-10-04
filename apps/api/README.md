# Luke API

<!-- luke-docs:start:overview -->
Luke's backend: Fastify + tRPC + Prisma on PostgreSQL. It serves every tRPC procedure behind the dashboard — collection layout, pricing, milestone calendar, NAV sales statistics, user and company management — on the `/trpc` endpoint, plus the plain HTTP health and readiness probes documented below. It also owns the cross-cutting controls: granular `Resource:Action` RBAC, an audit log on every mutation, local/LDAP authentication selected by `auth.strategy` in AppConfig, and the security baseline (Helmet headers, per-IP and per-account rate limiting, HKDF-SHA256 derived secrets, multi-layer `tokenVersion` session revocation).
<!-- luke-docs:end:overview -->

## LDAP resilience and authentication fallback

`src/lib/ldapClient.ts` owns the resilient LDAP client; its settings come from
`auth.ldap.resilience.*` in AppConfig.

Every operation is retried with exponential backoff while it gets no usable
answer: nothing came back (a refused or reset connection, an unreachable host, a
TLS failure, a timeout), or the directory answered `busy` (51) or `unavailable`
(52). Any other LDAP result — a rejected password, a missing entry, an exceeded
time limit — is an answer and is final. The client tells the two apart by where
the error arises, not by its message: what ldapts rejects a bind or a search
with is either a result code or a failure to get an answer, and a search filter
is parsed before anything is sent.

The circuit breaker guards one step: the service-account bind that opens every
login. That bind carries nothing about the person logging in, so nothing a
caller types can move the breaker; the search, the user's own bind and the group
lookup are never counted, in either direction. With the defaults in
`APP_CONFIG_DEFAULTS` (`packages/core/src/schemas/config.ts`) it opens after five consecutive service
binds without a usable answer, and a service bind the directory answers — a
refusal included — zeroes the count. While it is open a login is refused before
any connection. After the ten-second cooldown it is half-open: one login at a
time is let through as a probe and every other is refused;
`halfOpenMaxAttempts` probes the directory answers — a refusal included — close
it (one by default), and a probe without a usable answer reopens it. There is one breaker per directory URL for
the whole process, shared by the client every login creates.

Two consequences of guarding that step alone:

- **The service account is a setup requirement.** Without both a bind DN and a
  bind password the directory is searched anonymously, the first thing sent
  already carries the username, and there is nothing for the breaker to guard:
  it never opens, during an outage every login waits out its own timeouts, and
  the outage is answered as wrong credentials (see the table below).
- A failure past the service bind — the bind answered, the search hanging —
  leaves the breaker closed. Each login waits out its own timeouts.

| Condition | Client behavior |
|-----------|-----------------|
| Circuit open and cooldown not elapsed, or half-open with a probe in flight | `SERVICE_UNAVAILABLE` (`LdapUnavailableError`), nothing sent |
| Invalid credentials during a bind (49) | `UNAUTHORIZED`, without retry |
| Any other directory result except 51 and 52 | The ldapts error, without retry |
| A search filter that does not parse | `BAD_REQUEST`, before anything is sent |
| No answer, or 51/52, on every attempt | `SERVICE_UNAVAILABLE` (`LdapUnavailableError`), the last error as its cause |

`src/services/auth.service.ts` selects `local-only`, `ldap-only`, `local-first`
or `ldap-first` using `auth.strategy`. `src/lib/ldapAuth.ts` runs the LDAP half
of a login, and what it does with a failure depends on whether the username has
been sent to the directory yet:

| Where the LDAP login stopped | `authenticateViaLdap` | Answer when nobody is authenticated | Audit `reason` |
|------------------------------|-----------------------|-------------------------------------|----------------|
| Before the username is sent: incomplete configuration, breaker open, service-account bind refused or left without an answer | throws | `SERVICE_UNAVAILABLE` | `ldap_unavailable` |
| From the search on: no entry, a search or user bind the directory refused | returns a refusal | `UNAUTHORIZED` | `invalid_credentials` |
| From the search on: a search or user bind left without a usable answer, a search filter that does not parse | returns a refusal | `UNAUTHORIZED` | `ldap_unavailable` |
| LDAP disabled | returns a refusal | `UNAUTHORIZED` | `invalid_credentials` |
| After the directory verified the password: the user record could not be written | throws | `SERVICE_UNAVAILABLE` | `ldap_unavailable` |

The answer is decided by what happens before the username is on the wire, and
by nothing else. A 503 for a failure met after that point would tell a caller
with no password which usernames the directory knows, so such a failure is
answered like a wrong password and recorded in the audit row, with its
`errorCode`, as what it was. The last row needs the password.

Every failure, thrown or returned, counts as no LDAP login, so each strategy's
local fallback applies first: under `ldap-first` and `local-first` a user with a
LOCAL credential and the right password logs in while LDAP is down, and the
table describes the answer only when nobody was authenticated. This is not a
guarantee that local fallback happens only during an LDAP outage. Local fallback
still requires an active Luke account, a LOCAL identity with a stored credential
and a valid local password. Disabling only the directory account does not
necessarily disable that local access path.

A bind proves a password only if it is a simple bind of a named entry: an empty
password is refused before anything is sent, and an entry whose DN is empty or
is the name of a SASL mechanism is never bound as. The group lookup decides only
the role of a user created at first login, so its failure — or that of the
service-account rebind before it — does not fail the login.

On the web side the two answers that say nothing about the account reach the
login page as the `code` of the Auth.js sign-in result. `unavailable`, for a
`SERVICE_UNAVAILABLE` (this one, or maintenance mode's), is thrown by
`apps/web/src/lib/loginAuthorize.ts`. `throttled`, for a rate-limited login, is
written by the route wrapper (`app/api/auth/[...nextauth]/route.ts`, through
`throttledSignIn` in `lib/loginThrottleContext.ts`) together with the `429`.

Under `ldap-only` the directory decides every login, with one exception: once
LDAP has not authenticated them, an administrator with a LOCAL credential can
log in with it. The `AUTH_LOGIN` row records it as `provider: 'local'` with
`strategy: 'ldap-only'`, and the administrators get an in-app notification (best
effort: muted for whoever turned the category off). There is no condition on why
LDAP refused, because a directory answering from the wrong subtree cannot be
told from an unknown user. Nobody else has a local path: a non-administrator's
correct local password is refused as a wrong one would be, before any check that
could answer differently, and audited as `local_login_not_allowed` — a reason that
replaces the LDAP one, while the row keeps its `errorCode`.

What this costs: under `ldap-only` a local administrator password is always a
live login path, for every administrator who has one — the seeded account, one
given local access on purpose, a local account later promoted — and nothing done
in the directory revokes it. LDAP provisioning creates no LOCAL credential.

**Setup requirement.** Before choosing `ldap-only`, make sure at least one
administrator can log in locally: active, approved, with a verified email when
`auth.requireEmailVerification` is on, and a local password somebody knows. A
forced local access counts only once its reset link has been used. The LDAP
settings page refuses `ldap-only` with LDAP disabled, and when no administrator
is active, approved, verified where required and holds a LOCAL credential under
their current username. That check sees a credential row, not whether anyone
knows the password: an unused forced local access passes it. Both are checks at
the moment of saving, and Maintenance → Config writes the same keys without
them.

While LDAP authenticates nobody and no such administrator exists, nobody can get
in. Changing the `auth.strategy` row in the database (it is read on every login)
restores the local fallback to the users who hold a LOCAL credential, but gives
nobody a password: that is what the command below is for.

## Recovering administrator access

When no administrator can sign in, `db:grant-local-access` issues a single-use
password-reset link for one named administrator, from a shell in the API
container:

```bash
node dist-scripts/scripts/grant-local-access.js --username <administrator> --dry-run
node dist-scripts/scripts/grant-local-access.js --username <administrator>
```

It prints the target database (host, port, name — never credentials), the
account it found, the application origin the link points to and what issuing
it does, then asks for the username to be typed back; `--yes` replaces that
confirmation in a non-interactive run, and without a terminal and without
`--yes` it refuses. `--dry-run` runs every check and writes nothing.

**The link is a credential.** Whoever opens it first sets that administrator's
password, so whoever can read the terminal output — scrollback, a recorded
console session, a shared screen — can take the account. It is printed once,
on standard output, and nowhere else: not in the logs, the audit row or the
notification. Open it directly, over HTTPS, and clear the terminal afterwards.
It works once, for 30 minutes. When `app.baseUrl` is not stored, or is not an
http(s) URL, only the path is printed, to be opened on the application's host.

What it does, in one transaction with its audit row: it creates the LOCAL
identity if the account has none (with a password nobody knows), deletes the
account's other reset tokens — every reset link sent before stops working, even
if the new one is never used — and issues the new one. The password and the open
sessions change only when the link is used, through the normal reset page,
which applies the password policy and signs out every session. Under `ldap-only`
the administrator then signs in through the break-glass path above; under the
other strategies, through the local one. Every issuance writes a
`USER_LOCAL_ACCESS_FORCED` row (`source: 'cli'`) and notifies the administrators
in-app — best effort: muted for whoever turned the category off, and a failed
notification is only reported on standard error.

What it never does: create an administrator, change a role, reactivate, approve
or verify. It refuses an unknown username, a non-administrator, a deactivated
account, and a LOCAL identity it cannot use (left under an old username by a
rename, or belonging to another account). An account pending approval, or with
an unverified email while `auth.requireEmailVerification` is on, is refused
unless `--anyway` is given; the link is then issued, but the sign-in keeps being
refused until that state is changed. A deactivated account must be reactivated
before the command will run at all; approval and verification can be changed
before or after. Each is a decision of its own, made in the database and
recorded nowhere else:

```sql
UPDATE users SET "isActive" = true WHERE username = '<administrator>';
UPDATE users SET "pendingApproval" = false WHERE username = '<administrator>';
UPDATE users SET "emailVerifiedAt" = now() WHERE username = '<administrator>';
```

## Password reset and email verification audit events

These action names are recorded for the password-reset and email-verification
flows, by the authentication service (`src/services/auth.service.ts`) unless the
table names another emitter:

| Action | Flow |
|--------|------|
| `PASSWORD_RESET_REQUESTED` | Password-reset requests |
| `PASSWORD_CHANGED` | Password-reset confirmation |
| `EMAIL_VERIFICATION_SENT` | Email-verification requests; emitted by `src/lib/emailHelpers.ts` |
| `EMAIL_VERIFIED` | Email-verification confirmation |
| `USER_LOCAL_ACCESS_FORCED` | A reset link issued to give an account local access. Written by `users.forceLocalAccess` (success and failure), and by `db:grant-local-access` (`source: 'cli'`) only for a link it issued: a refusal, a dry run or a rolled-back attempt writes no row |

These names do not imply success: inspect the audit row's `result` and available
metadata, such as `reason`. Failure paths also use these actions, with two
exceptions: a wrong password on `auth.resendVerification` is recorded as
`AUTH_LOGIN_FAILED`, like a failed login, and its refusal of an address already
verified writes no row. A generic
success response to a password-reset request does not prove that an email was
sent; the service deliberately avoids disclosing whether the account exists.

## Security Headers

L'API implementa una baseline completa di HTTP security headers tramite Helmet, configurata centralmente in `src/lib/helmet.ts`.

### Configurazione per Ambiente

| Header                      | Valore                                                        | Dev | Test | Prod |
| --------------------------- | ------------------------------------------------------------- | --- | ---- | ---- |
| `X-Content-Type-Options`    | `nosniff`                                                     | ✅  | ✅   | ✅   |
| `Referrer-Policy`           | `no-referrer`                                                 | ✅  | ✅   | ✅   |
| `X-DNS-Prefetch-Control`    | `off`                                                         | ✅  | ✅   | ✅   |
| `X-Frame-Options`           | `DENY`                                                        | ✅  | ✅   | ✅   |
| `Content-Security-Policy`   | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | ❌  | ✅   | ✅   |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains`                         | ❌  | ❌   | ✅   |

### Policy di Sicurezza

- **CSP**: Configurazione minimale per API JSON-only, disabilitata in development
- **HSTS**: Solo in produzione con 180 giorni di durata
- **Frame Protection**: Blocco completo embedding in iframe
- **Content Type**: Prevenzione MIME sniffing
- **Referrer**: Nessuna informazione referrer esposta
- **DNS Prefetch**: Disabilitato per prevenire leak DNS

### Test di Verifica

I security headers sono verificati automaticamente tramite test end-to-end:

```bash
pnpm -F @luke/api test security.headers.spec.ts
```

I test verificano:

- Presenza di tutti gli header base
- Configurazione CSP corretta per ambiente
- Assenza HSTS in test/development
- Snapshot invariabile della configurazione

## Sviluppo

```bash
# Installazione dipendenze
pnpm install

# Avvio in development
pnpm -F @luke/api dev

# Test
pnpm -F @luke/api test

# Build
pnpm -F @luke/api build
```

## Health & Readiness Checks

L'API implementa un sistema completo di health checks per Kubernetes e monitoring.

### Endpoints Disponibili

| Endpoint      | Scopo           | Status Code | Descrizione                                              |
| ------------- | --------------- | ----------- | -------------------------------------------------------- |
| `/livez`      | Liveness Probe  | 200         | Verifica che il processo sia attivo                      |
| `/readyz`     | Readiness Probe | 200/503     | Verifica che il sistema sia pronto per servire richieste |
| `/healthz`    | Legacy Health   | 200         | Endpoint di compatibilità                                |
| `/api/health` | Detailed Health | 200         | Status dettagliato con uptime e versione                 |

### Comportamento Readiness (`/readyz`)

Il sistema esegue verifiche modulari in parallelo:

- **Database**: Connessione e query di test
- **Secrets**: Verifica derivazione segreti JWT
- **LDAP**: Connessione LDAP (se abilitato)

**Status Codes:**

- `200`: Tutti i check passano → sistema pronto
- `503`: Almeno un check fallisce → sistema non pronto

**Payload di Risposta:**

```json
{
  "status": "ready|unready",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok",
    "secrets": "ok",
    "ldap": "ok"
  }
}
```

The secrets check fails only when secret derivation fails. It does **not** detect
a missing or replaced master key: `getMasterKey` creates a new key when the file
is absent, and the probe derives `api.jwt` without being able to tell one key
from another. See [ADR-020](../../docs/decisions/020-master-key-scope-and-rotation-limits.md).

### Bootstrap Fail-Fast

Durante l'avvio, il server esegue verifiche critiche che devono passare:

1. **Database Connection**: `prisma.$connect()`
2. **Master Key**: `validateMasterKey()`
3. **Secret Derivation**: `deriveSecret('api.jwt')`

Se qualsiasi verifica fallisce, il processo termina con `process.exit(1)` per garantire che il server non si avvii in uno stato inconsistente.

**Known limit — this is not a guarantee that the master key is the expected one.**
`validateMasterKey()` only checks that the key file is 32 bytes, and when the
file is **absent** `getMasterKey()` creates a new one, so the check passes. A lost
or replaced master key therefore does not stop startup here; it surfaces later as
decryption failures at the point of use, or at boot only when a key listed in
`CRITICAL_CONFIG_KEYS` is itself stored encrypted, since `validateCriticalConfig`
reads those through the decrypting reader. See
[ADR-020](../../docs/decisions/020-master-key-scope-and-rotation-limits.md).

### Configurazione Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3
```

## Endpoints

- **Health**: `/api/health` - Status dell'API
- **Liveness**: `/livez` - Kubernetes liveness probe
- **Readiness**: `/readyz` - Kubernetes readiness probe
- **tRPC**: `/trpc` - Endpoint principale tRPC

## Configuration

Runtime configuration lives in the `AppConfig` table. `src/lib/configManager.ts` reads it and
validates each key against `AppConfigRegistry` (`packages/core/src/schemas/config.ts`); admins
edit it from the settings pages through tRPC. Environment variables carry only the bootstrap
values in the environment table below, and no configuration file is read. Rationale:
[ADR-018](../../docs/decisions/018-runtime-configuration-and-bootstrap-environment.md).

### Hardening & Shutdown semantics

- Error handling globale: Fastify `setErrorHandler` e hook `onError` loggano in modo strutturato con `traceId` da header `x-luke-trace-id`. In produzione i messaggi sono generici (niente stack in response).
- tRPC error responses: which message reaches the client, per status and environment, is in [OPERATIONS.md — Error responses](../../OPERATIONS.md#error-responses). The tRPC `onError` in `src/server.ts` logs the path, the code, the original message and the cause's message, unredacted.
- Process guards: `SIGTERM`/`SIGINT` eseguono graceful shutdown con timeout; `uncaughtException`/`unhandledRejection` loggano a livello `fatal`, tentano `app.close()` best-effort, poi `process.exit(1)`.
- Timeout: Fastify usa `requestTimeout` e `connectionTimeout` conservativi.

## Router tRPC

<!-- luke-docs:start:trpc-routers -->
| Namespace | Description |
|-----------|-------------|
| `auditLog.*` | Audit trail lookups — "last modified" per entity and the full export page |
| `auth.*` | Login, API token refresh, password reset, email verification, LDAP pending-approval email flow |
| `brand.*` | Brand management (CRUD, soft delete, logo upload) |
| `catalog.*` | Master Brand/Season lists for context selection, filtered by the user's allowlist |
| `collectionCatalog.*` | Collection catalog items |
| `collectionLayout.*` | Collection plan — layout, groups, rows, quotations, drag-and-drop ordering |
| `collectionLayoutRevision.*` | Collection plan revisions (ISO 9001 snapshots) |
| `company.*` | Company profile, functions, teams and brand scopes |
| `config.*` | AppConfig keys — centralized runtime configuration |
| `context.*` | Current user context (active brand/season) |
| `dashboard.*` | Dashboard widgets — KPI data, season progress, weekly sales |
| `editLock.*` | Planning wizard session lock (acquire/release/assert) |
| `feedback.*` | Internal feedback system |
| `holidays.*` | National holidays and vendor closure periods |
| `integrations.auth.*` | LDAP configuration and connection test |
| `integrations.google.*` | Google Calendar OAuth 2.0 — authorization flow and binding |
| `integrations.importExport.*` | Data import and export |
| `integrations.mail.*` | SMTP configuration and test email delivery |
| `integrations.nav.*` | NAV configuration, manual sync trigger, sync logs |
| `maintenance.backup.*` | Backup and restore of the application database |
| `maintenance.mode.*` | Maintenance mode (write lock, user-facing banner) |
| `me.*` | Current user profile, active sessions, session revocation |
| `merchandisingPlan.*` | Merchandising plan — specsheets, components, images |
| `notifications.*` | User notifications and notification preferences |
| `phase.*` | Unified Phase catalog (row production status + calendar) |
| `phaseAlert.*` | Phase saturation alert engine — computed on demand, nothing persisted |
| `phaseHistory.*` | Phase transition history for the predictive stagnation dashboard |
| `planningGroup.*` | PlanningGroup CRUD — scoping for CalendarEvent and CollectionLayoutRow |
| `pricing.*` | Pricing engine — parameter sets, forward/inverse/margin calculation |
| `public.*` | Public endpoints, no authentication |
| `sales.*` | Order portfolio statistics and the KIMO sales+returns report (NAV replicas `nav_pf_*` / `nav_kimo_*`) |
| `season.*` | Season management (CRUD, soft delete) |
| `seasonCalendar.*` | Seasonal milestone calendar, planning groups, templates and Google sync |
| `sectionAccess.*` | Per-user RBAC section visibility (user-level override) |
| `storage.*` | Upload slots and FileObject confirmation (presigned S3 uploads), S3 connection test, storage configuration |
| `system.*` | Manual calendar digest trigger (sends the caller their own digest) |
| `users.*` | User management — merge of `core` (CRUD), `admin` (pending LDAP user approval, session revocation, email-verification override, local-access bypass) and `preferences.*` |
| `vendors.*` | Vendor management (CRUD, soft delete, closure periods) |
<!-- luke-docs:end:trpc-routers -->

## Packages interni utilizzati

<!-- luke-docs:start:internal-deps -->
- `@luke/core` — Zod schemas, RBAC (`requirePermission`), `AppConfigRegistry`, `getConfigValue`, URL and storage utilities, server-only crypto (`@luke/core/server`)
- `@luke/db` — Prisma schema, migrations, generated client and `createPrismaClient`; every Prisma type is imported from here, never from `@prisma/client`
- `@luke/nav` — NAV sync layer: `runNavSync`, `testNavConnection`, `queryPortafoglioOrdini`, plus the dedicated Portafoglio and KIMO sync/query entry points (`syncPortafoglioNow`, `syncKimoNow`, `queryPortafoglioFromPg`, `queryKimoFromPg`)
- `@luke/calendar` — Google Calendar sync and iCal feed generation
<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | connection URL | — | PostgreSQL connection string. Required. |
| `PORT` | number | `3001` | Server listen port |
| `HOST` | address | `0.0.0.0` | Server bind address |
| `NODE_ENV` | enum | `development` | Runtime mode (`development` / `production` / `test`) |
| `LUKE_CORS_ALLOWED_ORIGINS` | comma-separated list | — | Origins CORS accepts in production |
| `LUKE_TRUSTED_PROXY_CIDR` | comma-separated addresses/ranges | — | The range the reverse proxy speaks from. `X-Forwarded-*` is honoured only at hop 0 and only from inside this range, so `keyBy: 'ip'` rate limits and audit rows cannot be steered by a forged header. Missing or invalid in production, the server refuses to start (`src/lib/trustProxy.ts`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | — | OTLP trace collector. Tracing stays off while this is empty |
| `OTEL_ENABLED` | boolean | `true` | Set to `false` to disable tracing even with an endpoint configured (`src/instrument.ts`) |
| `LOG_LEVEL` | enum | `info` | Pino log level (`trace` / `debug` / `info` / `warn` / `error`) |
| `APP_VERSION` | string | absent | Release identity injected at build time as a Docker `ARG`/`ENV` from the git tag in CI. Not a secret, and never read from AppConfig so a running image cannot disagree with itself about which release it is. Absent means "no release identity"; display surfaces fall back to `dev` (`src/lib/appVersion.ts`) |

At boot, `assertEnvPolicy()` in `src/server.ts` checks that no forbidden variable is present (blocked patterns: `SMTP_*`, `LDAP_*`, `JWT_*`, `NEXTAUTH_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`). In production it calls `exit(1)`; elsewhere it warns. Everything else belongs in AppConfig (database), not in the environment.
<!-- luke-docs:end:env -->

### Local trace collector

For an API process running on the host, this disposable collector exposes OTLP
gRPC and the Jaeger UI on loopback. It follows the
[Jaeger all-in-one example](https://www.jaegertracing.io/docs/2.21/getting-started/)
with only the two ports needed here:

```bash
docker run --rm --name luke-jaeger \
  -p 127.0.0.1:4317:4317 \
  -p 127.0.0.1:16686:16686 \
  cr.jaegertracing.io/jaegertracing/jaeger:2.21.0
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` in the API process
environment and leave `OTEL_ENABLED` unset or set to `true`. The compiled API's
`start` script preloads `src/instrument.ts`'s compiled output; the `dev` script
does not preload it. Setting the variables alone is not sufficient without
loading that instrumentation bootstrap before the server.

Open `http://localhost:16686` to inspect traces for service `@luke/api`.
The collector uses transient in-memory storage: stopping it loses the traces.
This command is documentation-verified, not an end-to-end tracing smoke test.

## Database

<!-- luke-docs:start:database -->
PostgreSQL through Prisma. The schema, the migrations and the generated client all live in `@luke/db` (`packages/db/prisma/*.prisma`, a flat multi-file layout split by domain); what stays here is the seed and the domain `db:*` scripts, which apply business rules and import `apps/api/src/`.

```bash
pnpm --filter @luke/db prisma:studio    # Open Prisma Studio in the browser
pnpm --filter @luke/api db:seed         # Initial seed (first boot)
pnpm --filter @luke/api db:bootstrap    # Development only: reset the database, then seed admin and base config
```

Creating a migration is a workflow of its own, not a single command: see [`docs/prisma-migration-workflow.md`](../../docs/prisma-migration-workflow.md). Run any `prisma` CLI command from `packages/db/`, the only directory that resolves config, schema and migrations together. In production `entrypoint.sh` runs `prisma migrate deploy` before the server starts; the migrations are version-controlled in `packages/db/prisma/migrations/`.

**80 models**, grouped by the schema file that owns them:

- `identity.prisma` — `User`, `Identity`, `LocalCredential`, `UserToken`, `UserSectionAccess`, `UserPreference`
- `platform.prisma` — `AppConfig`, `AuditLog`, `FileObject`, `EditLock`, `SchedulerLock`, `BackupRecord`, `Notification`, `NotificationPreference`, `NotificationDedupKey`, `DashboardConfig`, `DashboardTask`, `FeedbackSubmission`
- `catalog.prisma` — `Brand`, `Season`, `Vendor`, `PricingParameterSet`, `NavSyncFilter`, `NavVendor`, `NavBrand`, `NavSeason`
- `collection.prisma` — `CollectionLayout`, `CollectionGroup`, `CollectionLayoutRow`, `CollectionRowQuotation`, `CollectionRowPhaseHistory`, `CollectionCatalogItem`, and the four `*Revision` snapshot models
- `merchandising.prisma` — `MerchandisingPlan`, `MerchandisingPlanRow`, `MerchandisingSpecsheet`, `MerchandisingComponent`, `MerchandisingImage`
- `calendar.prisma` — `SeasonCalendar`, `PlanningGroup`, `CalendarEvent`, `MilestoneTemplate`, `MilestoneTemplateItem`, `Phase`, `HolidayCountry`, `Holiday`, `VendorClosurePeriod`, `GoogleCalendarBinding`, `GoogleEventMapping`, `CalendarDigestDelivery` (one row per daily digest email); `CalendarEventVisibility` and `MilestoneTemplateItemVisibility` grant company-function visibility, while `CalendarEventUserVisibility` and `CalendarEventPersonalNote` are per-user
- `company.prisma` — `CompanyProfile`, `CompanyFunction`, `CompanyTeam`, `CompanyTeamMembership`, `CompanyTeamBrandScope`
- `nav-analytics.prisma` — the `NavPf*` order-portfolio replica and `NavKimoSalesHeader` / `NavKimoSalesLine`

`schema.prisma` itself holds only the `generator` and `datasource` blocks.
<!-- luke-docs:end:database -->

### All-day event dates

An all-day event is stored at the UTC midnight of its date. The API refuses any write that would leave an all-day row off midnight — moving only one end of a row already stored that way included — and refuses to clone one; older clients wrote the local midnight of whoever entered the event. `db:fix-allday-dates` rereads every all-day row in `Europe/Rome` and moves it to the UTC midnight of that day — the day a user in Rome picked, wrong only for a row entered from another zone — then resyncs the affected Google calendars (`--no-sync` skips that). Read the `--dry-run` list before applying it, and run it before users edit on a web that reads the stored date: saving such a row from the event form writes the date it reads, a day early for a row entered in Rome. The image pins `TZ=UTC`, so in the API container the compiled script takes the zone on its own command line:

```bash
pnpm --filter @luke/api db:fix-allday-dates --dry-run                        # development
TZ=Europe/Rome node dist-scripts/scripts/fix-allday-event-dates.js --dry-run   # API container
```

### Calendar date range

Every date of a calendar event (`startAt`, `endAt`, `baselineStartAt`, `baselineEndAt`) and a
planning group's `anchorDate` must lie in the years 1900–9999: the calendar-date helpers throw
outside them. Migration `20260929224334_calendar_dates_in_supported_years` enforces it with CHECK
constraints, validated when they are added — on a database holding a row out of range, `migrate
deploy` fails and `entrypoint.sh` stops the API from starting. Count such rows before deploying it;
the result must be 0:

```sql
SELECT count(*) FROM calendar_events
WHERE "startAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "endAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "baselineStartAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999'
   OR "baselineEndAt" NOT BETWEEN '1900-01-01' AND '9999-12-31 23:59:59.999';
SELECT count(*) FROM planning_groups WHERE "anchorDate" NOT BETWEEN '1900-01-01' AND '9999-12-31';
```

A row out of range was typed wrong (a year entered as `26`): correct its date by hand. If the
migration has already failed, correct the rows, mark it rolled back with `prisma migrate resolve
--rolled-back 20260929224334_calendar_dates_in_supported_years` (from `packages/db/`, against that
database) and deploy again.

## NAV Sync

<!-- luke-docs:start:nav -->
NAV sync runs through `packages/nav`, which talks to SQL Server directly via `mssql`. Its configuration (server, database, company, credentials) is stored encrypted in AppConfig — no environment variable, and `packages/nav` never imports from `apps/api`: the config arrives injected as a `GetConfigFn`.

The pattern is a **one-way NAV → Luke sync**. Each entity has a `nav_*` replica table faithful to NAV and an enriched local table (`vendors`, `brands`, `seasons`). The sync never writes back to NAV, never touches `isActive`, and never reactivates an entity that was disabled by hand.

Synchronized entities: **Vendor** (watermark differential), **Brand** (full sync), **Season** (full sync), **order portfolio** (`nav_pf_*` replica behind sales statistics), **KIMO** (`nav_kimo_*` replica behind the sales+returns report). Each entity is synced inside its own try/catch, so one failure does not block the others.

Triggers: manually from `/settings/nav-sync` in the frontend (Vendor/Brand/Season) or via `sales.statistics.kimo.triggerSync` (KIMO), and through `navSyncScheduler.ts`, `portafoglioSyncScheduler.ts` and `kimoSyncScheduler.ts`. Their per-entity intervals are stored in `NavSyncFilter` rows. Every scheduled run takes a `SchedulerLock` row so two instances cannot sync the same entity concurrently.

Table naming, NAV-side details and the decisions behind them: [`docs/nav-integration.md`](../../docs/nav-integration.md).
<!-- luke-docs:end:nav -->

## Storage

<!-- luke-docs:start:storage -->
The storage layer is abstracted behind `IStorageProvider` (from `@luke/core`). The active provider is selected by `storage.type` in AppConfig — `local` or `s3` — with no environment variable and no rebuild. Files are never handled outside a provider implementation, and destination paths are always produced by the builder functions rather than assembled by hand.

**Two-phase upload**: the file is written as a pending `FileObject` (`confirmedAt = null`); confirmation happens in the same Prisma transaction that creates the owning entity. Abandoned pending files are reclaimed by the periodic cleanup (`setupTempFileCleanup` in `src/server.ts`).

**Valid buckets** are declared once, in `APP_STORAGE_BUCKETS` (`packages/core/src/storage/types.ts`); `isValidBucket()` in `packages/core/src/storage/config.ts` derives from that tuple and additionally admits the internal `backups` bucket. The list is deliberately not repeated here — a second copy would drift from the type that gates it.

Images are served through the Next.js proxy `/api/uploads/[...path]`, so the buckets stay private and are never exposed directly.
<!-- luke-docs:end:storage -->

### Provider implementation status

The storage factory in `src/storage/index.ts` implements local filesystem and
S3-compatible storage. `SambaStorageProvider` and `GDriveStorageProvider` are
unimplemented extension ideas, not available providers.

The legacy `storage.smb` and `storage.drive` AppConfig keys still have
registered Zod schemas. No dedicated procedure writes them any more, though the
generic `config.*` write procedures still accept them (`storage` is an allowed
prefix and both keys are registered), and no storage provider or web UI reads
them. Storage configuration (local / S3) goes through
`storage.getConfig`/`saveConfig`.
