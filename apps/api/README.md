# Luke API

<!-- luke-docs:start:overview -->
API server per Luke con tRPC, Prisma, autenticazione e sicurezza avanzata.
<!-- luke-docs:end:overview -->

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

### Bootstrap Fail-Fast

Durante l'avvio, il server esegue verifiche critiche che devono passare:

1. **Database Connection**: `prisma.$connect()`
2. **Master Key**: `validateMasterKey()`
3. **Secret Derivation**: `deriveSecret('api.jwt')`

Se qualsiasi verifica fallisce, il processo termina con `process.exit(1)` per garantire che il server non si avvii in uno stato inconsistente.

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

## Configurazione

L'API supporta configurazione tramite:

- Variabili d'ambiente
- Database configuration (tramite tRPC)
- File di configurazione

Vedi `src/lib/config.ts` per dettagli.

### Hardening & Shutdown semantics

- Error handling globale: Fastify `setErrorHandler` e hook `onError` loggano in modo strutturato con `traceId` da header `x-luke-trace-id`. In produzione i messaggi sono generici (niente stack in response).
- tRPC `errorFormatter`: uniforma il body errore evitando leak di dettagli. `onError` tRPC logga `code` e `message` redatti.
- Process guards: `SIGTERM`/`SIGINT` eseguono graceful shutdown con timeout; `uncaughtException`/`unhandledRejection` loggano a livello `fatal`, tentano `app.close()` best-effort, poi `process.exit(1)`.
- Timeout: Fastify usa `requestTimeout` e `connectionTimeout` conservativi. Le integrazioni esterne (es. LDAP) rispettano `AbortController` per abort controllato.

## Router tRPC

<!-- luke-docs:start:trpc-routers -->
| Namespace | Descrizione |
|-----------|-------------|
| `auth.*` | Autenticazione, logout, cambio password, reset password, verifica email |
| `brand.*` | Gestione brand (CRUD, soft delete, logo upload) |
| `calendarCatalog.*` | Catalogo eventi calendario (template milestone) |
| `catalog.*` | Catalogo articoli |
| `collectionCatalog.*` | Catalogo collezione |
| `collectionLayout.*` | Piano campionario — layout, gruppi, righe, quote, drag-and-drop |
| `collectionLayoutRevision.*` | Revisioni piano campionario (snapshot ISO 9001) |
| `company.*` | Profilo aziendale, funzioni, team e scopi brand |
| `config.*` | Chiavi AppConfig — configurazione runtime centralizzata |
| `context.*` | Contesto utente corrente (brand/stagione attivi) |
| `dashboard.*` | Widget dashboard — dati KPI, avanzamento stagione, ordini settimanali |
| `feedback.*` | Sistema feedback interno |
| `health.*` | Health check e status API |
| `holidays.*` | Festività nazionali e periodi di chiusura fornitori |
| `integrations.google.*` | OAuth 2.0 Google Calendar — flusso di autorizzazione e binding |
| `integrations.import.*` | Import dati da file |
| `integrations.ldap.*` | Configurazione e test connessione LDAP |
| `integrations.mail.*` | Configurazione SMTP e invio email di test |
| `integrations.nav.*` | Configurazione NAV, trigger sync manuale, log sync |
| `integrations.storage.*` | Configurazione provider storage (locale / MinIO) |
| `maintenance.*` | Operazioni di manutenzione e admin di sistema |
| `me.*` | Profilo utente corrente, sessioni attive, revoca sessioni |
| `merchandisingPlan.*` | Piano merchandising — specsheet, componenti, immagini |
| `notifications.*` | Notifiche utente e preferenze notifica |
| `pricing.*` | Motore prezzi — parameter set, calcolo forward/inverse/margin |
| `public.*` | Endpoint pubblici senza autenticazione |
| `sales.*` | Statistiche portafoglio ordini (replica NAV `nav_pf_*`) |
| `season.*` | Gestione stagioni (CRUD, soft delete) |
| `seasonCalendar.*` | Calendario milestones stagionali, dipendenze, solver |
| `sectionAccess.*` | Visibilità sezioni RBAC per utente (override user-level) |
| `storage.*` | Upload file, conferma FileObject, download presigned URL |
| `users.*` | Gestione utenti (`admin`, `core`, `preferences`) — CRUD, ruoli, preferenze |
| `vendors.*` | Gestione fornitori (CRUD, soft delete, periodi di chiusura) |
<!-- luke-docs:end:trpc-routers -->

## Packages interni utilizzati

<!-- luke-docs:start:internal-deps -->
- `@luke/core` — Schemi Zod, RBAC (`requirePermission`), `AppConfigRegistry`, `getConfigValue`, utility URL e storage, crypto server-only (`@luke/core/server`)
- `@luke/nav` — Sync layer NAV, `runNavSync`, `testNavConnection`, `queryPortafoglioOrdini`
- `@luke/calendar` — Sync Google Calendar, solver dipendenze milestone, generazione feed iCal
<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->
| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `DATABASE_URL` | — | URL connessione PostgreSQL (richiesta) |
| `PORT` | `3001` | Porta di ascolto del server |
| `HOST` | `0.0.0.0` | Indirizzo di bind del server |
| `NODE_ENV` | `development` | Runtime mode (`development` / `production` / `test`) |
| `LUKE_CORS_ALLOWED_ORIGINS` | — | Origini CORS ammesse in produzione (separare con virgola) |
| `OTEL_*` | — | OpenTelemetry — export trace (standard OTEL env vars) |
| `LOG_LEVEL` | `info` | Livello log Pino (`trace` / `debug` / `info` / `warn` / `error`) |

Al boot, `assertEnvPolicy()` in `src/server.ts` verifica che nessuna variabile vietata sia presente (pattern bloccati: `SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`). In produzione: `exit(1)`. Tutto il resto va in AppConfig (database).
<!-- luke-docs:end:env -->

## Database

<!-- luke-docs:start:database -->
PostgreSQL 16 via Prisma 7. Schema in `apps/api/prisma/schema.prisma`.

```bash
pnpm --filter @luke/api prisma:studio   # Apre Prisma Studio (browser)
pnpm --filter @luke/api db:seed         # Seed iniziale (primo avvio)
pnpm --filter @luke/api db:bootstrap    # Bootstrap sviluppo con dati di esempio
```

In produzione `entrypoint.sh` esegue `prisma migrate deploy` prima dell'avvio del server. Le migration sono versionata in `prisma/migrations/`.

**Model principali** (62 totali): `User`, `Identity`, `LocalCredential`, `AppConfig`, `AuditLog`, `FileObject`, `Brand`, `Season`, `Vendor`, `CollectionLayout`, `CollectionGroup`, `CollectionLayoutRow`, `CollectionLayoutRevision`, `PricingParameterSet`, `MerchandisingPlan`, `SeasonCalendar`, `CalendarEvent`, `MilestoneTemplate`, `GoogleCalendarBinding`, `NavVendor`, `NavBrand`, `NavSeason`, `NavPfSalesHeader`, `NavPfSalesLine`, `CompanyProfile`, `Notification`, `DashboardConfig`.
<!-- luke-docs:end:database -->

## NAV Sync

<!-- luke-docs:start:nav -->
Il sync NAV usa `packages/nav` con connessione diretta SQL Server via mssql. La configurazione (server, database, company, credenziali) è salvata cifrata in AppConfig — nessuna env var.

Pattern: sync **unidirezionale NAV → Luke**. Ogni entità ha una tabella replica `nav_*` (fedele a NAV) e una tabella locale arricchita (`vendors`, `brands`, `seasons`). Il sync non scrive mai su NAV, non tocca `isActive`, non riattiva entità disabilitate manualmente.

Entità sincronizzate: **Vendor** (differenziale watermark), **Brand** (full sync), **Season** (full sync), **Portafoglio ordini** (replica `nav_pf_*` per statistiche vendite).

Trigger sync: manuale via `/settings/nav-sync` nel frontend, oppure job periodico configurabile via AppConfig.
<!-- luke-docs:end:nav -->

## Storage

<!-- luke-docs:start:storage -->
Il layer storage è astratto da `IStorageProvider` (da `@luke/core`). Il provider attivo è selezionato da `storage.type` in AppConfig — `local` o `minio` — senza env var né ricompilazione.

**Upload a due fasi**: il file è caricato come `FileObject` pending (`confirmedAt = null`); la conferma avviene nella stessa transaction Prisma che crea l'entità. File pending abbandonati sono rimossi dal job di cleanup periodico.

**Bucket validi**: `uploads`, `exports`, `assets`, `brand-logos`, `collection-row-pictures`, `collection-row-pictures-revisions`, `merchandising-specsheet-images`, `company-assets`

Le immagini sono servite attraverso il proxy Next.js `/api/uploads/[...path]` — i bucket restano privati (non esposti pubblicamente).
<!-- luke-docs:end:storage -->
