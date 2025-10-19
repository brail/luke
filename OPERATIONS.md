# Luke - Operational Tuning

Documentazione operativa per SRE/DevOps su configurazioni runtime, rate-limiting, idempotency, session management, security headers e health checks.

## 📋 Indice

- [Rate Limiting](#-rate-limiting)
- [Idempotency](#-idempotency)
- [Session Management](#-session-management)
- [Security Headers](#-security-headers)
- [Security Hardcoded Values](#-security-hardcoded-values)
- [Readiness & Health Checks](#-readiness--health-checks)
- [Configurazioni per Ambiente](#-configurazioni-per-ambiente)

---

## 🔒 Security Hardcoded Values

Alcuni valori di sicurezza sono **intenzionalmente hardcoded** per prevenire misconfigurazioni e garantire la sicurezza del sistema:

### JWT Configuration

```typescript
// apps/api/src/lib/jwt.ts
const JWT_CONFIG = {
  algorithm: 'HS256', // Fisso: algoritmo sicuro
  clockTolerance: 30, // Fisso: 30 secondi di tolleranza
  defaultExpiresIn: '7d', // Fisso: 7 giorni di validità
  issuer: 'luke-api', // Fisso: identificatore issuer
  audience: 'luke-web', // Fisso: identificatore audience
};
```

### HSTS Configuration

```typescript
// apps/api/src/lib/helmet.ts
const HSTS_CONFIG = {
  maxAge: 15552000, // Fisso: 180 giorni (NIST recommendation)
  includeSubDomains: true, // Fisso: include sottodomini
  preload: true, // Fisso: abilita preload
};
```

### CSP Directives

```typescript
// apps/api/src/lib/helmet.ts
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"], // Fisso: solo self
  scriptSrc: ["'self'"], // Fisso: no inline scripts
  styleSrc: ["'self'", "'unsafe-inline'"], // Fisso: inline styles permessi
  imgSrc: ["'self'", 'data:', 'https:'], // Fisso: immagini sicure
  connectSrc: ["'self'"], // Fisso: solo self per XHR
  fontSrc: ["'self'"], // Fisso: solo self per font
  objectSrc: ["'none'"], // Fisso: no object/embed
  mediaSrc: ["'self'"], // Fisso: solo self per media
  frameSrc: ["'none'"], // Fisso: no iframe
  baseUri: ["'self'"], // Fisso: solo self per base
  formAction: ["'self'"], // Fisso: solo self per form
  frameAncestors: ["'none'"], // Fisso: no embedding
  upgradeInsecureRequests: [], // Fisso: upgrade HTTP a HTTPS
};
```

### Encryption Configuration

```typescript
// apps/api/src/lib/configManager.ts
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm', // Fisso: algoritmo sicuro
  keyLength: 32, // Fisso: 256 bit
  ivLength: 16, // Fisso: 128 bit IV
  tagLength: 16, // Fisso: 128 bit tag
  saltLength: 32, // Fisso: 256 bit salt
};
```

### Password Hashing

```typescript
// apps/api/src/lib/password.ts
const ARGON2_CONFIG = {
  type: argon2.argon2id, // Fisso: argon2id (resistente a side-channel)
  memoryCost: 2 ** 16, // Fisso: 64 MB
  timeCost: 3, // Fisso: 3 iterazioni
  parallelism: 1, // Fisso: 1 thread
  hashLength: 32, // Fisso: 256 bit hash
};
```

### Perché Hardcoded?

1. **Sicurezza**: Prevenire misconfigurazioni che potrebbero compromettere la sicurezza
2. **Consistenza**: Garantire che tutti gli ambienti usino configurazioni sicure
3. **Audit**: Valori fissi sono più facili da auditare e verificare
4. **Performance**: Evitare overhead di lettura da database per valori critici
5. **Compliance**: Rispettare standard di sicurezza (NIST, OWASP)

### Configurazioni Parametrizzabili

Le seguenti configurazioni **possono** essere modificate via AppConfig:

- Rate limiting policies
- Session duration e refresh
- LDAP/SMTP timeouts
- Password policy (con minimi hardcoded)
- CORS origins (con fallback sicuri)

---

## 🚦 Rate Limiting

### Configurazione per Rotta

| Endpoint            | AppConfig Key               | ENV Vars Pattern                    | Default Max | Default Window | Key By | Dev     | Prod   |
| ------------------- | --------------------------- | ----------------------------------- | ----------- | -------------- | ------ | ------- | ------ |
| `auth.login`        | `rateLimit.login`           | `LUKE_RATE_LIMIT_LOGIN_*`           | 5 req       | 1m             | IP     | 20 req  | 5 req  |
| `me.changePassword` | `rateLimit.passwordChange`  | `LUKE_RATE_LIMIT_PASSWORDCHANGE_*`  | 3 req       | 15m            | userId | 20 req  | 3 req  |
| `config.*`          | `rateLimit.configMutations` | `LUKE_RATE_LIMIT_CONFIGMUTATIONS_*` | 20 req      | 1m             | userId | 100 req | 20 req |
| `users.*`           | `rateLimit.userMutations`   | `LUKE_RATE_LIMIT_USERMUTATIONS_*`   | 10 req      | 1m             | userId | 50 req  | 10 req |

### Risoluzione Policy (AppConfig → ENV → Default)

**Ordine di precedenza:**

1. **AppConfig** (database): `rateLimit` key con JSON object
2. **Environment**: `LUKE_RATE_LIMIT_*` variables
3. **Default**: Valori hardcoded sicuri

#### Configurazione AppConfig

```json
{
  "rateLimit": {
    "login": { "max": 10, "timeWindow": "2m", "keyBy": "ip" },
    "passwordChange": { "max": 5, "timeWindow": "20m", "keyBy": "userId" },
    "configMutations": { "max": 30, "timeWindow": "1m", "keyBy": "userId" },
    "userMutations": { "max": 15, "timeWindow": "1m", "keyBy": "userId" }
  }
}
```

#### Configurazione ENV

```bash
# Override singole rotte
export LUKE_RATE_LIMIT_LOGIN_MAX=10
export LUKE_RATE_LIMIT_LOGIN_WINDOW=2m
export LUKE_RATE_LIMIT_LOGIN_KEY_BY=ip

export LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX=5
export LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW=20m
export LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY=userId
```

**Formato timeWindow**: Supporta `30s`, `1m`, `2h` (secondi, minuti, ore)

### Testing Rate Limits

#### Test Login Rate Limit

```bash
# Prime 5 richieste OK
for i in {1..5}; do
  curl -X POST http://localhost:3001/trpc/auth.login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrong"}'
done

# 6a richiesta → TOO_MANY_REQUESTS
curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrong"}'
```

**Output errore:**

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Rate limit exceeded for login. Max 5 requests per 1 minute(s)."
  }
}
```

#### Test Password Change Rate Limit

```bash
# Test con utente autenticato
TOKEN="your-jwt-token"
for i in {1..3}; do
  curl -X POST http://localhost:3001/trpc/me.changePassword \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $(uuidgen)" \
    -d '{"currentPassword":"old","newPassword":"new123!"}'
done
```

### Store e Cleanup

- **Store**: In-memory LRU cache (max 1000 keys per rotta)
- **Cleanup**: Automatico ogni minuto
- **TTL**: Window sliding con cleanup automatico
- **Key extraction**: IP per endpoint pubblici, userId per endpoint autenticati

---

## 🔄 Idempotency

### Header e Formato

**Header richiesto**: `Idempotency-Key: <UUID-v4>`

**Formato UUID v4**: `550e8400-e29b-41d4-a716-446655440000`

### Configurazione

| Parametro    | Valore                       | Descrizione          |
| ------------ | ---------------------------- | -------------------- |
| **TTL**      | 5 minuti                     | Cache automatica     |
| **Max Size** | 1000 keys                    | LRU eviction         |
| **Hash**     | SHA256(method + path + body) | Validazione univoca  |
| **Cleanup**  | Ogni minuto                  | Rimozione automatica |

### Endpoint Protetti

| Endpoint              | Descrizione                      | Esempio          |
| --------------------- | -------------------------------- | ---------------- |
| `auth.login`          | Prevenzione doppi login          | Login duplicato  |
| `me.changePassword`   | Prevenzione doppi cambi password | Password change  |
| `config.set/update`   | Prevenzione doppi aggiornamenti  | Config mutations |
| `users.create/update` | Prevenzione doppi aggiornamenti  | User mutations   |

### Comportamento

#### Richiesta Duplicata (Stesso Body)

```bash
# Prima chiamata: esegue e salva risultato
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"test","email":"test@test.com","password":"Test123!","role":"viewer"}'

# Seconda chiamata: ritorna risultato cached (no duplicato)
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"test","email":"test@test.com","password":"Test123!","role":"viewer"}'
```

#### Conflitto (Stessa Key, Body Diverso)

```bash
# Prima chiamata
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"user1","email":"user1@test.com","password":"Test123!","role":"viewer"}'

# Seconda chiamata con body diverso → 409 Conflict
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"user2","email":"user2@test.com","password":"Test123!","role":"viewer"}'
```

**Output conflitto:**

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Idempotency-Key already used with different request body. Each key must identify a single operation."
  }
}
```

#### Formato UUID Invalido

```bash
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: not-a-uuid" \
  -d '{"username":"test","email":"test@test.com","password":"Test123!","role":"viewer"}'
```

**Output errore:**

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid Idempotency-Key format. Must be a valid UUID v4."
  }
}
```

### Best Practices

1. **Genera UUID v4** per ogni operazione unica
2. **Usa stessa key** per retry della stessa operazione
3. **Non riutilizzare key** per operazioni diverse
4. **Gestisci 409 Conflict** nel client (nuova key per operazione diversa)
5. **Non usare per query** (solo mutation hanno bisogno di idempotency)

---

## 🔐 Session Management

### TTL Configurazione per Ambiente

| Ambiente  | maxAge | updateAge | API JWT expiresIn | Cookie Secure | Cookie SameSite |
| --------- | ------ | --------- | ----------------- | ------------- | --------------- |
| **Dev**   | 8h     | 4h        | 8h                | false         | lax             |
| **Stage** | 8h     | 4h        | 8h                | true          | lax             |
| **Prod**  | 8h     | 4h        | 8h                | true          | lax             |

### TokenVersion Flow

#### Quando Incrementa

- **Cambio password**: `me.changePassword`
- **Revoca sessioni**: `me.revokeAllSessions`
- **Admin revoca**: Admin revoca sessioni di altri utenti
- **Disabilita utente**: Admin disabilita utente (opzionale)

#### Cache e Invalidazione

| Parametro         | Valore                  | Descrizione                          |
| ----------------- | ----------------------- | ------------------------------------ |
| **Cache TTL**     | 60s                     | `security.tokenVersionCacheTTL`      |
| **Invalidazione** | Immediata               | Dopo increment tokenVersion          |
| **Verifica**      | Ogni richiesta protetta | JWT.tokenVersion === DB.tokenVersion |

#### Architettura Multi-Layer

```
Admin revoca sessioni → tokenVersion incrementato nel DB
├── API: Verifica tokenVersion → 401 Unauthorized ✅
├── NextAuth: Verifica tokenVersion nel callback jwt → return null → Logout automatico ✅
├── Middleware: Verifica tokenVersion su navigazione → Redirect a /login ✅
└── Client: Verifica periodica ogni 10s + su focus → Redirect immediato ✅
```

### Cookie Security Flags

#### Development

```typescript
cookies: {
  sessionToken: {
    name: 'next-auth.session-token',
    options: {
      httpOnly: true,
      secure: false, // HTTP OK in dev
      sameSite: 'lax',
      path: '/',
    },
  },
}
```

#### Production

```typescript
cookies: {
  sessionToken: {
    name: 'next-auth.session-token',
    options: {
      httpOnly: true,
      secure: true, // Solo HTTPS
      sameSite: 'lax',
      path: '/',
    },
  },
}
```

### Testing Session Management

#### Verifica Cookie in DevTools

1. **Apri DevTools** → Application → Cookies
2. **Verifica flags**:
   - `httpOnly: true` ✅
   - `secure: false` (dev) / `secure: true` (prod) ✅
   - `sameSite: lax` ✅
3. **Test logout**: Cookie deve essere rimosso

#### Test TokenVersion

```bash
# 1. Login e ottieni token
TOKEN=$(curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | jq -r '.result.token')

# 2. Cambia password (incrementa tokenVersion)
curl -X POST http://localhost:3001/trpc/me.changePassword \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"currentPassword":"changeme","newPassword":"newpass123!"}'

# 3. Vecchio token ora è invalido
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/trpc/me.get
# → 401 Unauthorized
```

---

## 🛡️ Security Headers

### Headers per Ambiente

| Header                      | Value                                                         | Dev | Test | Prod | Note                          |
| --------------------------- | ------------------------------------------------------------- | --- | ---- | ---- | ----------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                                     | ✅  | ✅   | ✅   | Prevenzione MIME sniffing     |
| `Referrer-Policy`           | `no-referrer`                                                 | ✅  | ✅   | ✅   | Nessuna informazione referrer |
| `X-DNS-Prefetch-Control`    | `off`                                                         | ✅  | ✅   | ✅   | Prevenzione leak DNS          |
| `X-Frame-Options`           | `DENY`                                                        | ✅  | ✅   | ✅   | Blocco embedding iframe       |
| `Content-Security-Policy`   | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | ❌  | ✅   | ✅   | CSP minimale API-only         |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains`                         | ❌  | ❌   | ✅   | HSTS solo produzione          |

### Policy di Sicurezza

#### CSP (Content Security Policy)

- **Produzione**: Configurazione minimale per API JSON-only
- **Sviluppo**: Disabilitata per evitare problemi di sviluppo
- **Directives**: `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`

#### HSTS (HTTP Strict Transport Security)

- **Produzione**: 180 giorni, includeSubDomains, no preload
- **Sviluppo/Test**: Disabilitato

### Testing Security Headers

#### Verifica Headers con curl

```bash
# Verifica tutti gli header
curl -I http://localhost:3001/

# Output atteso (Development):
# X-Content-Type-Options: nosniff
# Referrer-Policy: no-referrer
# X-DNS-Prefetch-Control: off
# X-Frame-Options: DENY

# Output atteso (Production):
# X-Content-Type-Options: nosniff
# Referrer-Policy: no-referrer
# X-DNS-Prefetch-Control: off
# X-Frame-Options: DENY
# Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
# Strict-Transport-Security: max-age=15552000; includeSubDomains
```

#### Test Automatici

```bash
# Esegui test automatici per security headers
pnpm -F @luke/api test security.headers.spec.ts
```

I test verificano:

- Presenza di tutti gli header base
- Configurazione CSP corretta per ambiente
- Assenza HSTS in test/development
- Snapshot invariabile della configurazione

---

## 🏥 Readiness & Health Checks

### Endpoint Disponibili

| Endpoint      | Tipo            | Status  | Checks              | Descrizione                   |
| ------------- | --------------- | ------- | ------------------- | ----------------------------- |
| `/livez`      | Liveness        | 200     | Process alive       | Event loop responsive         |
| `/readyz`     | Readiness       | 200/503 | DB + Secrets + LDAP | Sistema pronto per richieste  |
| `/healthz`    | Legacy Health   | 200     | Basic               | Endpoint di compatibilità     |
| `/api/health` | Detailed Health | 200     | Extended            | Status dettagliato con uptime |

### Semantica Status Codes

#### Liveness (`/livez`)

- **200**: Processo attivo, event loop responsive
- **Sempre 200**: Se il server risponde, il processo è vivo

#### Readiness (`/readyz`)

- **200**: Tutti i check passano → sistema pronto
- **503**: Almeno un check fallisce → sistema non pronto

### Checks Eseguiti

#### Database

- **Test**: `SELECT 1` query
- **Timeout**: 2 secondi
- **Fallback**: 503 se DB non raggiungibile

#### Secrets

- **Test**: Derivazione segreti JWT via HKDF
- **Fallback**: 503 se master key non disponibile

#### LDAP (Opzionale)

- **Test**: Bind LDAP con timeout 2s
- **Fallback**: 503 se LDAP abilitato ma non raggiungibile
- **Skip**: Se LDAP disabilitato, check passa

### Esempi di Output

#### Readiness OK (200)

```bash
curl -sSf http://localhost:3001/readyz
```

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

#### Readiness Failed (503)

```bash
curl -sSf http://localhost:3001/readyz
```

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

### Troubleshooting

#### Readiness Failed - Database

```bash
# Verifica connessione database
curl http://localhost:3001/readyz
# Output: "database": "failed: Connection refused"
```

#### Readiness Failed - Secrets

```bash
# Verifica master key
ls -la ~/.luke/secret.key
# Output: -rw------- 1 user user 32 Jan 15 10:30 ~/.luke/secret.key
```

#### Readiness Failed - LDAP

```bash
# Verifica configurazione LDAP
curl http://localhost:3001/trpc/config.get?input=%7B%22key%22%3A%22auth.ldap.url%22%7D
# Output: Configurazione LDAP o "LDAP disabled, skipped"
```

---

## 🌍 Configurazioni per Ambiente

### Rate Limiting

| Ambiente  | Login     | Password Change | Config Mutations | User Mutations |
| --------- | --------- | --------------- | ---------------- | -------------- |
| **Dev**   | 20 req/1m | 20 req/15m      | 100 req/1m       | 50 req/1m      |
| **Stage** | 10 req/1m | 10 req/15m      | 50 req/1m        | 25 req/1m      |
| **Prod**  | 5 req/1m  | 3 req/15m       | 20 req/1m        | 10 req/1m      |

### Idempotency

| Ambiente  | TTL   | Max Size | Cleanup Interval |
| --------- | ----- | -------- | ---------------- |
| **Dev**   | 5 min | 1000     | 1 min            |
| **Stage** | 5 min | 1000     | 1 min            |
| **Prod**  | 5 min | 1000     | 1 min            |

### Session Management

| Ambiente  | maxAge | updateAge | Cookie Secure | Cookie SameSite |
| --------- | ------ | --------- | ------------- | --------------- |
| **Dev**   | 8h     | 4h        | false         | lax             |
| **Stage** | 8h     | 4h        | true          | lax             |
| **Prod**  | 8h     | 4h        | true          | lax             |

### Security Headers

| Ambiente  | CSP | HSTS      | X-Frame-Options |
| --------- | --- | --------- | --------------- |
| **Dev**   | ❌  | ❌        | DENY            |
| **Stage** | ✅  | ❌        | DENY            |
| **Prod**  | ✅  | ✅ (180d) | DENY            |

### Readiness Check Timeouts

| Ambiente  | Database | Secrets | LDAP |
| --------- | -------- | ------- | ---- |
| **Dev**   | 2s       | 1s      | 2s   |
| **Stage** | 2s       | 1s      | 2s   |
| **Prod**  | 2s       | 1s      | 2s   |

### ENV Vars per Ambiente

#### Development

```bash
# Rate limiting permissivo
export LUKE_RATE_LIMIT_LOGIN_MAX=20
export LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX=20
export LUKE_RATE_LIMIT_CONFIGMUTATIONS_MAX=100
export LUKE_RATE_LIMIT_USERMUTATIONS_MAX=50

# CORS per sviluppo
export LUKE_CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
```

#### Staging

```bash
# Rate limiting intermedio
export LUKE_RATE_LIMIT_LOGIN_MAX=10
export LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX=10
export LUKE_RATE_LIMIT_CONFIGMUTATIONS_MAX=50
export LUKE_RATE_LIMIT_USERMUTATIONS_MAX=25

# CORS per staging
export LUKE_CORS_ALLOWED_ORIGINS="https://staging.example.com"
```

#### Production

```bash
# Rate limiting conservativo (usa defaults)
# Nessuna ENV var necessaria, usa valori hardcoded

# CORS per produzione
export LUKE_CORS_ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
```

---

## 🔗 Riferimenti

- [README.md](README.md) - Documentazione principale del progetto
- [API_SETUP.md](API_SETUP.md) - Setup e utilizzo dell'API
- [apps/api/README.md](apps/api/README.md) - Documentazione specifica API

## 🧪 Test Automatici

```bash
# Test security headers
pnpm -F @luke/api test security.headers.spec.ts

# Test session hardening
pnpm -F @luke/api test session.hardening.spec.ts

# Test rate limiting
pnpm -F @luke/api test ratelimit.spec.ts

# Test idempotency
pnpm -F @luke/api test idempotency.spec.ts

# Test readiness
pnpm -F @luke/api test readyz.spec.ts
```

---

**Luke** - Operational tuning per applicazioni enterprise sicure e scalabili 🚀
