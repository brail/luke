# Luke API

<!-- luke-docs:start:overview -->
Luke's backend: Fastify + tRPC + Prisma on PostgreSQL. It serves every tRPC procedure behind the dashboard — collection layout, pricing, milestone calendar, NAV sales statistics, user and company management — on the `/trpc` endpoint, plus the plain HTTP health and readiness probes documented below. It also owns the cross-cutting controls: granular `Resource:Action` RBAC, an audit log on every mutation, local/LDAP authentication selected by `auth.strategy` in AppConfig, and the security baseline (Helmet headers, per-IP and per-account rate limiting, HKDF-SHA256 derived secrets, multi-layer `tokenVersion` session revocation).
<!-- luke-docs:end:overview -->

## LDAP resilience and authentication fallback

`src/lib/ldapClient.ts` owns the resilient LDAP client; its settings come from
`auth.ldap.resilience.*` in AppConfig. With the defaults in
`packages/core/src/schemas/appConfig.ts`, its circuit breaker opens after five
consecutive failed operations. After a ten-second cooldown, the next operation
enters half-open state. One successful operation closes it by default; a failure
reopens it. `halfOpenMaxAttempts` counts successful half-open operations toward
closure, not concurrent requests: it does not limit admission to one request.

The breaker belongs to each `ResilientLdapClient` instance. Authentication creates
a new client per attempt, so this is not a shared breaker across login requests.

Error handling in the LDAP client is distinct from the authentication strategy:

| Condition | Client behavior |
|-----------|-----------------|
| Circuit already open, cooldown not elapsed | `SERVICE_UNAVAILABLE` |
| Invalid credentials during bind | `UNAUTHORIZED`, without retry |
| Invalid search filter or syntax | `BAD_REQUEST`, without retry |
| Search network error | Initially mapped to `BAD_GATEWAY` and retried; the retry loop can remap the final error to `SERVICE_UNAVAILABLE` based on its message |
| Network error recognized after retries are exhausted | `SERVICE_UNAVAILABLE` |

`src/services/auth.service.ts` selects `local-only`, `ldap-only`, `local-first`
or `ldap-first` using `auth.strategy`. In `ldap-first`, local authentication is
attempted after LDAP returns no user, including when `src/lib/ldapAuth.ts`
converts rejected user credentials to `null`. It also follows infrastructure
errors (`SERVICE_UNAVAILABLE` or `BAD_GATEWAY`); other tRPC errors are rethrown.
This is not a guarantee that local fallback happens only during an LDAP outage.
Local fallback still requires an active Luke account, a LOCAL identity with a
stored credential and a valid local password. Disabling only the directory
account does not necessarily disable that local access path.

## Password reset and email verification audit events

The authentication service (`src/services/auth.service.ts`) records these action
names for the password-reset and email-verification flows:

| Action | Flow |
|--------|------|
| `PASSWORD_RESET_REQUESTED` | Password-reset requests |
| `PASSWORD_CHANGED` | Password-reset confirmation |
| `EMAIL_VERIFICATION_SENT` | Email-verification requests; also emitted by `src/lib/emailHelpers.ts` |
| `EMAIL_VERIFIED` | Email-verification confirmation |

These names do not imply success: inspect the audit row's `result` and available
metadata, such as `reason`. Failure paths also use these actions. A generic
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
- tRPC `errorFormatter`: uniforma il body errore evitando leak di dettagli. `onError` tRPC logga `code` e `message` redatti.
- Process guards: `SIGTERM`/`SIGINT` eseguono graceful shutdown con timeout; `uncaughtException`/`unhandledRejection` loggano a livello `fatal`, tentano `app.close()` best-effort, poi `process.exit(1)`.
- Timeout: Fastify usa `requestTimeout` e `connectionTimeout` conservativi. Le integrazioni esterne (es. LDAP) rispettano `AbortController` per abort controllato.

## Router tRPC

<!-- luke-docs:start:trpc-routers -->
| Namespace | Description |
|-----------|-------------|
| `auditLog.*` | Audit trail lookups — "last modified" per entity and the full export page |
| `auth.*` | Authentication, logout, password change, password reset, email verification |
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
| `health.*` | Health check and API status |
| `holidays.*` | National holidays and vendor closure periods |
| `integrations.auth.*` | LDAP configuration and connection test |
| `integrations.google.*` | Google Calendar OAuth 2.0 — authorization flow and binding |
| `integrations.importExport.*` | Data import and export |
| `integrations.mail.*` | SMTP configuration and test email delivery |
| `integrations.nav.*` | NAV configuration, manual sync trigger, sync logs |
| `integrations.storage.*` | Storage provider configuration (local / S3) |
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
| `storage.*` | File upload, FileObject confirmation, presigned download URLs |
| `system.*` | System information and manual calendar digest trigger |
| `users.*` | User management — merge of `core` (CRUD), `admin` (session revocation, email verification) and `preferences.*` |
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
pnpm --filter @luke/api db:bootstrap    # Development bootstrap with sample data
```

Creating a migration is a workflow of its own, not a single command: see [`docs/prisma-migration-workflow.md`](../../docs/prisma-migration-workflow.md). Run any `prisma` CLI command from `packages/db/`, the only directory that resolves config, schema and migrations together. In production `entrypoint.sh` runs `prisma migrate deploy` before the server starts; the migrations are version-controlled in `packages/db/prisma/migrations/`.

**79 models**, grouped by the schema file that owns them:

- `identity.prisma` — `User`, `Identity`, `LocalCredential`, `UserToken`, `UserSectionAccess`, `UserPreference`
- `platform.prisma` — `AppConfig`, `AuditLog`, `FileObject`, `EditLock`, `SchedulerLock`, `BackupRecord`, `Notification`, `NotificationPreference`, `NotificationDedupKey`, `DashboardConfig`, `DashboardTask`, `FeedbackSubmission`
- `catalog.prisma` — `Brand`, `Season`, `Vendor`, `PricingParameterSet`, `NavSyncFilter`, `NavVendor`, `NavBrand`, `NavSeason`
- `collection.prisma` — `CollectionLayout`, `CollectionGroup`, `CollectionLayoutRow`, `CollectionRowQuotation`, `CollectionRowPhaseHistory`, `CollectionCatalogItem`, and the four `*Revision` snapshot models
- `merchandising.prisma` — `MerchandisingPlan`, `MerchandisingPlanRow`, `MerchandisingSpecsheet`, `MerchandisingComponent`, `MerchandisingImage`
- `calendar.prisma` — `SeasonCalendar`, `PlanningGroup`, `CalendarEvent`, `MilestoneTemplate`, `MilestoneTemplateItem`, `Phase`, `HolidayCountry`, `Holiday`, `VendorClosurePeriod`, `GoogleCalendarBinding`, `GoogleEventMapping`; `CalendarEventVisibility` and `MilestoneTemplateItemVisibility` grant company-function visibility, while `CalendarEventUserVisibility` and `CalendarEventPersonalNote` are per-user
- `company.prisma` — `CompanyProfile`, `CompanyFunction`, `CompanyTeam`, `CompanyTeamMembership`, `CompanyTeamBrandScope`
- `nav-analytics.prisma` — the `NavPf*` order-portfolio replica and `NavKimoSalesHeader` / `NavKimoSalesLine`

`schema.prisma` itself holds only the `generator` and `datasource` blocks.
<!-- luke-docs:end:database -->

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

The legacy `storage.smb` and `storage.drive` AppConfig keys have registered Zod
schemas and can be saved through `integrations.storage.saveConfig` with
`config:update` permission. No storage provider or current web UI consumes
those configurations. `integrations.storage.testConnection` requires
`config:read` but returns placeholder success without contacting either
service; its result does not establish connectivity. This scaffold dates to
October 2025 (`e38fd81d`) and does not constitute a working integration.
