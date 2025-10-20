# Luke API

API server per Luke con tRPC, Prisma, autenticazione e sicurezza avanzata.

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
