# Luke API - Setup e Utilizzo

## Indice

- [Avvio Rapido](#avvio-rapido)
- [Bootstrap Sviluppo](#bootstrap-sviluppo)
- [LDAP Resilienza](#ldap-resilienza)
- [Endpoint Disponibili](#endpoint-disponibili)
- [tRPC Endpoints](#trpc-endpoints)
- [Credenziali Admin](#credenziali-admin)
- [Database](#database)
- [Sicurezza](#sicurezza)
- [Architettura](#architettura)
- [Observability](#observability)
- [Health & Readiness](#health--readiness)
- [Troubleshooting](#troubleshooting)
- [Note](#note)
- [Riferimenti Correlati](#riferimenti-correlati)

## Avvio Rapido

### 1. Installazione Dipendenze

```bash
pnpm install
```

### 2. Generazione Prisma Client

```bash
pnpm --filter @luke/api prisma:generate
```

### 3. Setup Database e Seed

```bash
# Bootstrap completo (reset + migrations + seed + verifiche)
pnpm -w -F @luke/api db:bootstrap
```

**Cosa fa lo script**:

1. Verifica master key in `~/.luke/secret.key`
2. Backup automatico di `dev.db` (se esistente) con timestamp
3. Reset completo del database (drop + migrations)
4. Seed idempotente (admin user + configurazioni base)
5. Sanity checks automatici (utente admin, config critiche)

### Setup Manuale (Alternative)

```bash
# Reset database (senza seed)
pnpm -w -F @luke/api db:reset

# Esegui solo seed (idempotente)
pnpm -w -F @luke/api db:seed

# Genera Prisma client
pnpm -w -F @luke/api prisma:generate
```

### Note Importanti

- **Master Key**: La master key in `~/.luke/secret.key` è sempre preservata
- **Backup**: I backup di `dev.db` sono in `apps/api/prisma/dev.db.backup.*`
- **Idempotenza**: Il seed può essere eseguito multiple volte senza duplicazioni
- **LDAP**: Le configurazioni LDAP vanno aggiunte via UI (non nel seed)
- **Segreti**: I log non mostrano mai segreti in chiaro, solo metadati

### Troubleshooting

**Errore "Master key non accessibile"**:

```bash
# La master key sarà creata automaticamente al primo avvio
# Con permessi 0600 in ~/.luke/secret.key
```

**Errore "Database locked"**:

```bash
# Ferma tutti i processi che usano il DB
pkill -f "tsx.*server.ts"
pnpm -w -F @luke/api db:bootstrap
```

### 4. Avvio Server

```bash
pnpm --filter @luke/api dev
```

Il server sarà disponibile su `http://localhost:3001`

## Bootstrap Sviluppo

### Setup Iniziale Completo

Per configurare il database di sviluppo da zero:

```bash
# Bootstrap completo (reset + migrations + seed + verifiche)
pnpm -w -F @luke/api db:bootstrap
```

**Cosa fa lo script**:

1. Verifica master key in `~/.luke/secret.key`
2. Backup automatico di `dev.db` (se esistente) con timestamp
3. Reset completo del database (drop + migrations)
4. Seed idempotente (admin user + configurazioni base)
5. Sanity checks automatici (utente admin, config critiche)

### Setup Manuale (Alternative)

```bash
# Reset database (senza seed)
pnpm -w -F @luke/api db:reset

# Esegui solo seed (idempotente)
pnpm -w -F @luke/api db:seed

# Genera Prisma client
pnpm -w -F @luke/api prisma:generate
```

## LDAP Resilienza

### Panoramica

Il sistema LDAP include meccanismi di resilienza per gestire errori di rete, timeout e indisponibilità del servizio senza impattare la disponibilità dell'applicazione.

### Circuit Breaker

Il circuit breaker gestisce automaticamente la disponibilità del servizio LDAP:

```
CLOSED → (5 failures) → OPEN → (10s cooldown) → HALF_OPEN → (1 success) → CLOSED
```

**Stati**:

- **CLOSED**: Operazioni normali, contatore failure attivo
- **OPEN**: Servizio considerato down, richieste rifiutate immediatamente
- **HALF_OPEN**: Stato di prova, accetta 1 richiesta per testare il servizio

### Parametri Configurabili (AppConfig)

Configurazione tramite UI in `auth.ldap.resilience.*`:

| Parametro                 | Default | Descrizione                               |
| ------------------------- | ------- | ----------------------------------------- |
| `timeoutMs`               | 3000    | Timeout per operazione LDAP (ms)          |
| `maxRetries`              | 2       | Numero massimo di retry                   |
| `baseDelayMs`             | 200     | Delay base per exponential backoff (ms)   |
| `breakerFailureThreshold` | 5       | Soglia failure per aprire circuit breaker |
| `breakerCooldownMs`       | 10000   | Cooldown circuit breaker (ms)             |
| `halfOpenMaxAttempts`     | 1       | Tentativi max in stato half-open          |

### Error Mapping

Gli errori LDAP vengono mappati in `TRPCError` per gestione semantica:

| Errore LDAP                               | TRPCError Code        | Fallback Sicuro? | Descrizione                   |
| ----------------------------------------- | --------------------- | ---------------- | ----------------------------- |
| Network errors (timeout/refused/notfound) | `SERVICE_UNAVAILABLE` | ✅ Sì            | LDAP non raggiungibile        |
| Circuit breaker open                      | `SERVICE_UNAVAILABLE` | ✅ Sì            | Servizio temporaneamente down |
| Invalid credentials (bind 49)             | `UNAUTHORIZED`        | ❌ No            | Credenziali errate            |
| Operation network failure                 | `BAD_GATEWAY`         | ✅ Sì            | Errore durante operazione     |
| Invalid filter/syntax                     | `BAD_REQUEST`         | ❌ No            | Errore di configurazione      |

### Strategie di Autenticazione

**`local-first`**: Prova locale → LDAP (fallback sicuro)
**`ldap-first`**: Prova LDAP → locale (solo per errori infrastrutturali)

⚠️ **Sicurezza**: Con `ldap-first`, il fallback locale avviene **solo** per errori `SERVICE_UNAVAILABLE`/`BAD_GATEWAY`, mai per `UNAUTHORIZED` (credenziali errate).

### Esempio Configurazione

```json
{
  "auth.ldap.resilience.timeoutMs": "5000",
  "auth.ldap.resilience.maxRetries": "3",
  "auth.ldap.resilience.baseDelayMs": "300",
  "auth.ldap.resilience.breakerFailureThreshold": "3",
  "auth.ldap.resilience.breakerCooldownMs": "15000",
  "auth.ldap.resilience.halfOpenMaxAttempts": "2"
}
```

### Monitoraggio

I log includono:

- Transizioni circuit breaker con timestamp
- Retry attempts con delay
- Error mapping con traceId
- Redazione automatica password/credenziali

### Note Importanti

- **Master Key**: La master key in `~/.luke/secret.key` è sempre preservata
- **Backup**: I backup di `dev.db` sono in `apps/api/prisma/dev.db.backup.*`
- **Idempotenza**: Il seed può essere eseguito multiple volte senza duplicazioni
- **LDAP**: Le configurazioni LDAP vanno aggiunte via UI (non nel seed)
- **Segreti**: I log non mostrano mai segreti in chiaro, solo metadati

### Troubleshooting

**Errore "Master key non accessibile"**:

```bash
# La master key sarà creata automaticamente al primo avvio
# Con permessi 0600 in ~/.luke/secret.key
```

**Errore "Database locked"**:

```bash
# Ferma tutti i processi che usano il DB
pkill -f "tsx.*server.ts"
pnpm -w -F @luke/api db:bootstrap
```

**Errore "Prisma AI safety check"**:

```bash
# Prisma blocca comandi pericolosi quando eseguiti da AI agents
# Esegui manualmente il reset:
cd apps/api
pnpm prisma migrate reset --force --skip-seed

# Poi esegui solo il seed:
pnpm -w -F @luke/api db:seed
```

**Errore "Reset database fallito"**:

```bash
# Se il bootstrap fallisce al reset, esegui i passi manualmente:
cd apps/api
pnpm prisma migrate reset --force --skip-seed
pnpm -w -F @luke/api db:seed
```

## Endpoint Disponibili

### Health Check

```bash
curl http://localhost:3001/healthz
```

### Root

```bash
curl http://localhost:3001/
```

## tRPC Endpoints

### Users Router

#### Lista Utenti

```bash
curl "http://localhost:3001/trpc/users.list?input=%7B%7D"
```

#### Crea Utente

```bash
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"email":"user@example.com","username":"user","password":"password123","role":"viewer"}'
```

#### Ottieni Utente per ID

```bash
curl "http://localhost:3001/trpc/users.getById?input=%7B%22id%22%3A%22USER_ID%22%7D"
```

#### Aggiorna Utente

```bash
curl -X POST http://localhost:3001/trpc/users.update \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"id":"USER_ID","email":"newemail@example.com","role":"editor"}'
```

#### Elimina Utente (Soft Delete)

```bash
curl -X POST http://localhost:3001/trpc/users.delete \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"id":"USER_ID"}'
```

### Config Router

#### Lista Configurazioni (Paginata)

**⚠️ IMPORTANTE**: La lista configurazioni **non decritta mai** i valori cifrati per motivi di sicurezza. I valori cifrati mostrano `valuePreview: null`.

```bash
# Lista base con paginazione
curl "http://localhost:3001/trpc/config.list?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({page:1,pageSize:20})))')"

# Lista con filtri e ordinamento
curl "http://localhost:3001/trpc/config.list?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({page:1,pageSize:10,q:"auth",sortBy:"updatedAt",sortDir:"desc"})))')"

# Filtra per categoria
curl "http://localhost:3001/trpc/config.list?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({category:"auth",isEncrypted:true})))')"

# Ricerca con tutti i parametri
curl "http://localhost:3001/trpc/config.list?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({q:"ldap",category:"auth",isEncrypted:true,sortBy:"key",sortDir:"asc",page:1,pageSize:50})))')"
```

**Output atteso**:

```json
{
  "items": [
    {
      "key": "auth.ldap.url",
      "valuePreview": "ldaps://example.com",
      "isEncrypted": false,
      "category": "auth",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "key": "auth.ldap.password",
      "valuePreview": null,
      "isEncrypted": true,
      "category": "auth",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 45,
  "hasNextPage": true
}
```

#### Ottieni Configurazione

**⚠️ IMPORTANTE**: `decrypt=false` di default per sicurezza. `decrypt=true` richiede ruolo admin.

```bash
# Valore normale (non decrittato) - valori cifrati mostrano [ENCRYPTED]
curl "http://localhost:3001/trpc/config.get?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"app.name"})))')"

# Valore decrittato (solo admin) - richiede Authorization header
curl -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:3001/trpc/config.get?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"app.name",decrypt:true})))')"
```

**Output atteso**:

```json
{
  "key": "app.name",
  "value": "Luke",
  "isEncrypted": false
}
```

**Per valori cifrati senza decrypt**:

```json
{
  "key": "auth.ldap.password",
  "value": "[ENCRYPTED]",
  "isEncrypted": undefined
}
```

#### Visualizza Valore (Modalità Sicura)

**Modalità disponibili**:

- `masked`: disponibile per tutti gli utenti autenticati, valori cifrati mostrano `[ENCRYPTED]`
- `raw`: solo admin, decritta i valori cifrati, genera audit log obbligatorio

```bash
# Modalità masked (qualsiasi utente autenticato)
curl "http://localhost:3001/trpc/config.viewValue?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"auth.ldap.url",mode:"masked"})))')"

# Modalità raw (solo admin, audit obbligatorio)
curl -H "Authorization: Bearer YOUR_TOKEN" -H "x-luke-trace-id: trace-123" "http://localhost:3001/trpc/config.viewValue?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"auth.ldap.password",mode:"raw"})))')"
```

**Output atteso (masked)**:

```json
{
  "key": "auth.ldap.password",
  "value": "[ENCRYPTED]",
  "isEncrypted": true,
  "mode": "masked"
}
```

**Output atteso (raw)**:

```json
{
  "key": "auth.ldap.password",
  "value": "secret-password",
  "isEncrypted": true,
  "mode": "raw"
}
```

**⚠️ Nota**: Ogni accesso in modalità `raw` genera un audit log con metadati redatti per compliance.

#### Imposta Configurazione (Solo Admin)

```bash
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"key":"app.name","value":"Luke","encrypt":false}'
```

#### Imposta Configurazione Cifrata (Solo Admin)

```bash
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"key":"auth.ldap.password","value":"secret-password","encrypt":true}'
```

#### Elimina Configurazione (Solo Admin)

```bash
curl -X POST http://localhost:3001/trpc/config.delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"key":"config.key"}'
```

#### Protezione Chiavi Critiche

**⚠️ IMPORTANTE**: Le seguenti chiavi sono protette e non possono essere eliminate:

- `auth.strategy`, `auth.ldap.url`, `auth.ldap.searchBase`, `auth.ldap.searchFilter`
- `mail.smtp`, `storage.smb`, `storage.drive`
- `nextauth.secret`, `jwt.secret`

**Motivazione**: Prevenire la rottura di configurazioni essenziali per il funzionamento del sistema.

**Errore per chiavi critiche**:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "La chiave 'auth.strategy' è critica e non può essere eliminata"
  }
}
```

#### Export JSON (Solo Admin)

**⚠️ IMPORTANTE**: I segreti cifrati non vengono mai esportati in chiaro per motivi di sicurezza.

```bash
# Export solo metadata (senza valori)
curl -X POST "http://localhost:3001/trpc/config.exportJson" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{"includeValues":false}'

# Export con valori (segreti cifrati mostrano [ENCRYPTED])
curl -X POST "http://localhost:3001/trpc/config.exportJson" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{"includeValues":true}'
```

**Output atteso**:

```json
{
  "configs": [
    {
      "key": "app.name",
      "category": "app",
      "isEncrypted": false,
      "value": "Luke",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "key": "auth.ldap.password",
      "category": "auth",
      "isEncrypted": true,
      "value": "[ENCRYPTED]",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "exportedAt": "2024-01-15T10:30:00.000Z",
  "includeValues": true,
  "count": 2
}
```

#### Import JSON (Solo Admin)

**⚠️ IMPORTANTE**: `value: null` viene saltato, `encrypt: true` cifra il valore.

```bash
curl -X POST "http://localhost:3001/trpc/config.importJson" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{
    "items": [
      {"key":"app.name","value":"Luke","encrypt":false},
      {"key":"auth.ldap.url","value":"ldaps://example.com","encrypt":true},
      {"key":"auth.ldap.password","value":null,"encrypt":true}
    ]
  }'
```

**Output atteso**:

```json
{
  "successCount": 2,
  "errorCount": 0,
  "errors": []
}
```

**Nota**: L'item con `value: null` viene saltato automaticamente.

## Credenziali Admin

Dopo il seed, è disponibile un utente admin:

- **Email**: `admin@luke.local`
- **Username**: `admin`
- **Password**: `changeme`
- **Ruolo**: `admin`

⚠️ **IMPORTANTE**: Cambia la password admin al primo login!

## Database

### Prisma Studio

Per visualizzare e modificare il database tramite UI:

```bash
pnpm --filter @luke/api prisma:studio
```

Disponibile su `http://localhost:5555`

### Reset Database

Per resettare completamente il database:

```bash
rm apps/api/prisma/dev.db*
pnpm --filter @luke/api seed
```

## Sicurezza

### Master Key

La master key per la cifratura è salvata in `~/.luke/secret.key` (chmod 600).

### Password Hashing

Le password sono hashate con **argon2id** (time cost: 3, memory: 65536).

### Cifratura Configurazioni

I valori sensibili sono cifrati con **AES-256-GCM**.

### JWT Token Signing

- **Algoritmo**: HS256 (HMAC-SHA256) esplicito
- **Secret**: Derivato via HKDF-SHA256 dalla master key
- **Parametri HKDF**: salt='luke', info='api.jwt', length=32 bytes
- **Claim standard**: `iss: 'urn:luke'`, `aud: 'luke.api'`, `exp`, `nbf`
- **Clock tolerance**: ±60 secondi per gestire skew temporale
- **Scope**: Server-only, mai esposto via HTTP
- **Rotazione**: Rigenera master key per invalidare tutti i token
- **Nessun endpoint pubblico**: Il secret JWT non è mai esposto via API

### Session Hardening

#### tokenVersion

Ogni utente ha un campo `tokenVersion` (default: 0) che viene incrementato quando:

- Cambia password (`me.changePassword`)
- Revoca tutte le sessioni (`me.revokeAllSessions`)
- Admin disabilita utente o cambia ruolo (opzionale)

**Validazione:**

- Ogni richiesta tRPC protetta verifica che `JWT.tokenVersion === DB.tokenVersion`
- Se mismatch → `UNAUTHORIZED` (sessione invalidata)
- JWT senza `tokenVersion` → **rifiutati immediatamente** (no backward-compat)

**Cache:**

- `tokenVersion` cachato in-memory per ridurre query DB
- TTL configurabile via AppConfig: `security.tokenVersionCacheTTL` (default: 60000ms = 60s)
- Cache invalidata manualmente dopo increment tokenVersion

#### Cookie Flags (Produzione)

```typescript
cookies: {
  sessionToken: {
    name: 'next-auth.session-token',
    options: {
      httpOnly: true,
      secure: true, // Solo HTTPS in prod
      sameSite: 'lax',
      path: '/',
    },
  },
}
```

#### TTL Sessioni

- **maxAge**: 8 ore (28800s)
- **updateAge**: 4 ore (14400s) — refresh silenzioso al 50% lifetime
- API JWT: 8 ore (allineato a NextAuth)

#### Test

Suite completa in `apps/api/test/session.hardening.spec.ts`:

- Login → changePassword → UNAUTHORIZED con vecchio token
- revokeAllSessions → vecchio token rifiutato
- JWT senza tokenVersion → UNAUTHORIZED
- Token scaduto → UNAUTHORIZED
- Utente disabilitato → UNAUTHORIZED

### NextAuth Secret Derivation

- **Algoritmo**: HKDF-SHA256 (RFC 5869)
- **Input**: Master key (~/.luke/secret.key)
- **Parametri**: salt='luke', info='nextauth.secret', length=32 bytes
- **Output**: Base64url string
- **Scope**: Server-only, mai esposto via HTTP
- **Nessun database**: Il secret non è mai salvato, solo derivato on-demand

### Rate Limiting & Idempotency

Il sistema implementa rate limiting per-rotta e idempotency per mutazioni critiche.

Per configurazioni dettagliate, esempi pratici e best practices, consulta:

- [OPERATIONS.md - Rate Limiting](OPERATIONS.md#rate-limiting)
- [OPERATIONS.md - Idempotency](OPERATIONS.md#idempotency)

### RBAC Guards

- **Middleware riusabili**: `withRole()`, `roleIn()`, `adminOnly`, `adminOrEditor`
- **Composizione**: Guardie combinabili per logica complessa
- **Type-safe**: Context tRPC con session garantita

### Configurazioni (AppConfig)

Il sistema utilizza configurazioni centralizzate in database con cifratura AES-256-GCM per segreti.

Per dettagli completi su:

- Schema delle 29 chiavi AppConfig
- Policy di cifratura e validazione
- RBAC e protezione chiavi critiche
- Import/Export JSON sicuro
- Audit log e tracing

Consulta [APP_CONFIG.md](APP_CONFIG.md).

## Architettura

### Modelli Database

- **User**: Utenti del sistema con ruoli RBAC
- **Identity**: Identità multi-provider (LOCAL, LDAP, OIDC)
- **LocalCredential**: Credenziali locali con hash password
- **AppConfig**: Configurazioni con supporto cifratura
- **AuditLog**: Log delle azioni (futuro)

### Router tRPC

- **users**: CRUD completo per gestione utenti
- **config**: Gestione configurazioni avanzata con:
  - Lista paginata con filtri e ordinamento
  - Visualizzazione valori con modalità masked/raw
  - Import/Export JSON sicuro
  - Validazione chiavi e protezione critiche
  - Audit log granulare

### Sicurezza

- **Helmet**: Security headers
- **CORS**: Cross-origin requests
- **Pino**: Logging strutturato
- **Graceful shutdown**: Chiusura pulita

## Security Headers & CORS

Luke implementa security headers standard (CSP, HSTS, X-Frame-Options) e strategia CORS ibrida.

Per configurazioni dettagliate, esempi per ambiente e test, consulta:

- [OPERATIONS.md - Security Headers](OPERATIONS.md#security-headers)

## Troubleshooting

### Errore "Master key deve essere di 32 bytes"

```bash
rm ~/.luke/secret.key
pnpm --filter @luke/api seed
```

### Errore "Database locked"

```bash
# Ferma il server e riavvia
pnpm --filter @luke/api dev
```

### Errore "Port 3001 already in use"

```bash
# Cambia porta o ferma processo esistente
PORT=3002 pnpm --filter @luke/api dev
```

## Observability

### OpenTelemetry Tracing

Luke API integra OpenTelemetry per distributed tracing enterprise-grade.

**Configurazione** (env vars):

- `OTEL_EXPORTER_OTLP_ENDPOINT`: Collector gRPC endpoint (es. `http://localhost:4317`)
- `OTEL_ENABLED`: Esplicita disabilitazione (`false`), default `true` se endpoint presente

**Collector locale** (esempio con Jaeger):

```bash
docker run -d --name jaeger \
  -p 4317:4317 -p 16686:16686 \
  jaegertracing/all-in-one:latest
```

**Traces inclusi**: HTTP, Fastify routes, Prisma queries, LDAP calls (futuro).

**Correlazione log**: Ogni log Pino include `traceId`, `spanId` (OTel) + `xTraceId` (business ID frontend).

### Probe Kubernetes

- **`/livez`**: Liveness probe (200 se process alive)
- **`/readyz`**: Readiness probe (200 solo se DB + secrets + LDAP OK)

**Esempio deployment**:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 3001
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
  periodSeconds: 5
  failureThreshold: 3
```

### Sicurezza Log

Pino serializer automatico redige: `password`, `secret`, `token`, `bindPassword`, valori cifrati AppConfig.

## Health & Readiness

Per troubleshooting dettagliato, esempi di failure scenarios e configurazione Kubernetes, consulta:

- [OPERATIONS.md - Readiness & Health Checks](OPERATIONS.md#readiness--health-checks)

### Differenza Liveness vs Readiness

- **Liveness (`/livez`)**: Verifica che il processo sia vivo e l'event loop responsive. Sempre 200 se il server è attivo.
- **Readiness (`/readyz`)**: Verifica che il sistema sia pronto a servire richieste:
  - Database connesso
  - Master key accessibile
  - Segreti JWT derivabili
  - LDAP server raggiungibile (se abilitato)

**Implicazioni Deploy**:

- Liveness failure → Kubernetes riavvia il pod
- Readiness failure → Kubernetes rimuove il pod dal load balancer (senza riavvio)
- Fail-fast al boot → Server termina con exit(1) se segreti non disponibili

### Liveness Probe (`/livez`)

Verifica che il processo sia attivo.

```bash
curl -sSf http://localhost:3001/livez
```

**Output atteso**:

```json
{
  "status": "ok"
}
```

### Readiness Probe (`/readyz`)

Verifica che il sistema sia pronto:

- Database connesso
- Master key disponibile
- Segreti JWT derivabili
- LDAP server raggiungibile (se abilitato)

```bash
curl -sSf http://localhost:3001/readyz
```

**Output atteso (ready)**:

```json
{
  "status": "ready",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": {
    "database": "ok",
    "secrets": "ok",
    "ldap": "ok"
  }
}
```

**Output atteso (not ready)**:

```json
{
  "status": "unready",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": {
    "database": "ok",
    "secrets": "ok",
    "ldap": "failed: LDAP timeout"
  }
}
```

**Note importanti**:

- Il server termina con `exit(1)` se la master key o i segreti non sono disponibili all'avvio (fail-fast)
- I provider opzionali come LDAP hanno timeout breve (2s) e non bloccano il readiness se falliscono
- I dettagli degli errori sono loggati internamente ma non esposti nella risposta HTTP per sicurezza

**Uso in Kubernetes**:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 3001
readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
```

## Note

- Il server usa **SQLite** per sviluppo, **PostgreSQL** per production
- Tutti gli endpoint sono **pubblici** (autenticazione da implementare)
- Le query tRPC usano **GET**, le mutation usano **POST**
- Il formato tRPC è compatibile con client TypeScript end-to-end

## Riferimenti Correlati

- [README.md](README.md) - Documentazione principale del progetto
- [APP_CONFIG.md](APP_CONFIG.md) - Gestione configurazioni centralizzate (AppConfig)
- [OPERATIONS.md](OPERATIONS.md) - Documentazione operativa per SRE/DevOps
- [SETUP_STATUS.md](SETUP_STATUS.md) - Registro tecnico interno e roadmap
- [docs/adr/](docs/adr/) - Architecture Decision Records
