# Luke API - Setup e Utilizzo

## 🚀 Avvio Rapido

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
pnpm --filter @luke/api seed
```

### 4. Avvio Server

```bash
pnpm --filter @luke/api dev
```

Il server sarà disponibile su `http://localhost:3001`

## 📊 Endpoint Disponibili

### Health Check

```bash
curl http://localhost:3001/healthz
```

### Root

```bash
curl http://localhost:3001/
```

## 🔗 tRPC Endpoints

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

## 🔑 Credenziali Admin

Dopo il seed, è disponibile un utente admin:

- **Email**: `admin@luke.local`
- **Username**: `admin`
- **Password**: `changeme`
- **Ruolo**: `admin`

⚠️ **IMPORTANTE**: Cambia la password admin al primo login!

## 🗄️ Database

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

## 🔐 Sicurezza

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

### Rate Limiting

- **Per-rotta**: Limiti specifici per endpoint sensibili
- **Configurazione dinamica**: AppConfig → ENV → Default
- **Key extraction**: IP per endpoint pubblici, userId per endpoint autenticati
- **Store**: In-memory LRU cache con TTL e cleanup automatico

> 📖 **Documentazione Operativa**: Per configurazioni dettagliate, esempi per ambiente e comandi di testing, consulta [OPERATIONS.md](../OPERATIONS.md#-rate-limiting).

#### Rate Limiting Configuration

**AppConfig (database)**:
Store a JSON object in `rateLimit` key:

```json
{
  "login": { "max": 10, "timeWindow": "2m", "keyBy": "ip" },
  "passwordChange": { "max": 5, "timeWindow": "20m", "keyBy": "userId" },
  "configMutations": { "max": 30, "timeWindow": "1m", "keyBy": "userId" },
  "userMutations": { "max": 15, "timeWindow": "1m", "keyBy": "userId" }
}
```

**Environment Variables**:
Override individual routes:

- `LUKE_RATE_LIMIT_LOGIN_MAX=10`
- `LUKE_RATE_LIMIT_LOGIN_WINDOW=2m`
- `LUKE_RATE_LIMIT_LOGIN_KEY_BY=ip`
- `LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX=5`
- `LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW=20m`
- `LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY=userId`
- `LUKE_RATE_LIMIT_CONFIGMUTATIONS_MAX=30`
- `LUKE_RATE_LIMIT_CONFIGMUTATIONS_WINDOW=1m`
- `LUKE_RATE_LIMIT_USERMUTATIONS_MAX=15`
- `LUKE_RATE_LIMIT_USERMUTATIONS_WINDOW=1m`

**Default Values (fallback)**:

| Endpoint            | Limite | Window | Key By |
| ------------------- | ------ | ------ | ------ |
| `auth.login`        | 5 req  | 1 min  | IP     |
| `me.changePassword` | 3 req  | 15 min | userId |
| `config.*`          | 20 req | 1 min  | userId |
| `users.*`           | 10 req | 1 min  | userId |

**Resolution Order**: AppConfig → ENV → Defaults

**Time Window Format**: Supporta `30s`, `1m`, `2h` (secondi, minuti, ore)

### Idempotency

- **Header**: `Idempotency-Key: <uuid-v4>`
- **Store**: In-memory LRU cache (max 1000 keys, TTL 5min)
- **Scope**: Mutazioni critiche (login, password change, config, users)
- **Hash**: SHA256(method + path + body) per validazione

> 📖 **Documentazione Operativa**: Per esempi pratici, testing collisioni e best practices, consulta [OPERATIONS.md](../OPERATIONS.md#-idempotency).

- **tRPC middleware**: Wrapper che riusa IdempotencyStore esistente

### RBAC Guards

- **Middleware riusabili**: `withRole()`, `roleIn()`, `adminOnly`, `adminOrEditor`
- **Composizione**: Guardie combinabili per logica complessa
- **Type-safe**: Context tRPC con session garantita

### Sicurezza Config Router

#### Regole di Sicurezza

- **Mai decrittare in bulk**: La lista configurazioni non restituisce mai valori in chiaro per chiavi cifrate
- **RBAC rigoroso**: Solo admin può creare/modificare/eliminare configurazioni
- **Validazione chiavi**: Formato `prefix.subkey` con prefissi ammessi: `app`, `auth`, `mail`, `storage`, `security`, `integrations`
- **Protezione chiavi critiche**: Chiavi essenziali (es: `auth.strategy`, `jwt.secret`) non possono essere eliminate
- **Audit log granulare**: Ogni visualizzazione raw genera log con metadati redatti
- **Export sicuro**: I segreti cifrati nell'export mostrano sempre `[ENCRYPTED]`, mai il plaintext
- **Tracing distribuito**: Header `x-luke-trace-id` per correlazione log cross-service

#### RBAC (Role-Based Access Control)

| Procedura                        | Ruolo Richiesto   | Descrizione                  |
| -------------------------------- | ----------------- | ---------------------------- |
| `config.list`                    | `loggedProcedure` | Qualsiasi utente autenticato |
| `config.get`                     | `loggedProcedure` | Qualsiasi utente autenticato |
| `config.viewValue` (mode=masked) | `loggedProcedure` | Qualsiasi utente autenticato |
| `config.viewValue` (mode=raw)    | `adminProcedure`  | Solo admin                   |
| `config.exists`                  | `loggedProcedure` | Qualsiasi utente autenticato |
| `config.getMultiple`             | `loggedProcedure` | Qualsiasi utente autenticato |
| `config.set`                     | `adminProcedure`  | Solo admin                   |
| `config.update`                  | `adminProcedure`  | Solo admin                   |
| `config.delete`                  | `adminProcedure`  | Solo admin                   |
| `config.setMultiple`             | `adminProcedure`  | Solo admin                   |
| `config.exportJson`              | `adminProcedure`  | Solo admin                   |
| `config.importJson`              | `adminProcedure`  | Solo admin                   |

#### Audit & Tracing

**Metadati Audit Log**:

- `CONFIG_VIEW_VALUE` (mode=raw): `{ key, mode: 'raw' }`
- `CONFIG_CREATE/UPDATE`: `{ key, isEncrypted, valueRedacted: '[ENCRYPTED]' | redact(value, 32) }`
- `CONFIG_DELETE`: `{ key }`
- `CONFIG_EXPORT`: `{ includeValues, count }`
- `CONFIG_IMPORT`: `{ key, isEncrypted, valueRedacted, source: 'import' }`

**Header Tracing**:

- `x-luke-trace-id`: generato automaticamente dal server per correlazione log
- Usato per tracciare operazioni cross-service e debugging distribuito

#### Chiavi Critiche Protette

Le seguenti chiavi non possono essere eliminate per motivi di sicurezza e funzionamento del sistema:

**Autenticazione e Autorizzazione:**

- `auth.strategy` - Strategia di autenticazione principale
- `auth.ldap.url` - URL server LDAP
- `auth.ldap.searchBase` - Base di ricerca LDAP
- `auth.ldap.searchFilter` - Filtro di ricerca LDAP
- `nextauth.secret` - Secret per NextAuth.js
- `jwt.secret` - Secret per firma token JWT

**Sicurezza e Cifratura:**

- `security.encryption.key` - Chiave master per cifratura

**Servizi Esterni Critici:**

- `mail.smtp` - Configurazione SMTP per email
- `storage.smb` - Configurazione storage SMB
- `storage.drive` - Configurazione storage drive

**Gestione Edge Cases:**

- Per eliminare una chiave critica, contattare l'amministratore di sistema
- In caso di emergenza, la chiave può essere temporaneamente rinominata invece di eliminata

#### Formato Chiavi Valido

- **Regex**: `/^(categories)(\\.[a-zA-Z0-9_-]+)+$/` (permette maiuscole per acronimi)
- **Prefissi ammessi**: `app`, `auth`, `mail`, `storage`, `security`, `integrations`
- **Esempi validi**: `auth.ldap.url`, `mail.smtp.host`, `storage.smb.password`, `auth.SAML.url`
- **Esempi non validi**: `app` (manca separatore), `auth.` (termina con punto), `invalid.prefix.key` (prefisso non ammesso)

## 🏗️ Architettura

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

## 🔒 Security Headers & CORS

### Helmet Configuration

Luke API utilizza `@fastify/helmet` per security headers ottimizzati per API JSON-only:

**CSP (Content Security Policy)**:

- **Produzione**: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` (minimale, no inline)
- **Sviluppo**: CSP disabilitata per evitare problemi di sviluppo

**HSTS (HTTP Strict Transport Security)**:

- **Produzione**: `maxAge: 15552000` (180 giorni), `includeSubDomains: true`, `preload: false`
- **Sviluppo**: Disabilitato

**Header aggiuntivi**:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `X-DNS-Prefetch-Control: off`

### CORS Strategy

Luke implementa una strategia CORS ibrida con priorità:

1. **AppConfig**: `appConfig.security.cors.allowedOrigins` (se presente)
2. **Environment**: `LUKE_CORS_ALLOWED_ORIGINS` (CSV, es. `https://app.example.com,https://admin.example.com`)
3. **Default**:
   - **Dev**: `['http://localhost:3000', 'http://localhost:5173']`
   - **Prod**: `[]` (deny-by-default)

**Configurazione ENV**:

```bash
# Esempio per produzione
export LUKE_CORS_ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
```

**Logging**: Il server logga la fonte CORS all'avvio senza esporre liste complete in produzione.

### Debug UI

Per abilitare logging di debug nel frontend in ambienti demo:

```bash
export NEXT_PUBLIC_LUKE_DEBUG_UI=true
```

Questo abilita `debugLog()`, `debugWarn()`, `debugError()` anche in produzione.

## 🛡️ Rate-Limit e Idempotency

### Rate-Limit per-rotta

Luke API implementa rate limiting mirato per proteggere endpoint sensibili:

**Configurazione**:

```typescript
// apps/api/src/lib/ratelimit.ts
export const RATE_LIMIT_CONFIG = {
  login: { max: 5, windowMs: 60_000, keyBy: 'ip' },
  passwordChange: { max: 3, windowMs: 900_000, keyBy: 'userId' },
  configMutations: { max: 20, windowMs: 60_000, keyBy: 'userId' },
  userMutations: { max: 10, windowMs: 60_000, keyBy: 'userId' },
};
```

**Applicazione**:

```typescript
// Esempio: auth.login
login: publicProcedure
  .use(withRateLimit('login'))
  .use(withIdempotency())
  .input(LoginSchema)
  .mutation(async ({ input, ctx }) => { ... })
```

**Comportamento**:

- **IP-based**: Per endpoint pubblici (login)
- **User-based**: Per endpoint autenticati (config, users)
- **TTL**: Window sliding con cleanup automatico
- **Error**: `TOO_MANY_REQUESTS` con retry-after

### Idempotency per mutate critiche

Prevenzione di richieste duplicate con header `Idempotency-Key`:

**Header richiesto**:

```bash
curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"username":"admin","password":"changeme"}'
```

**Comportamento**:

- **Prima richiesta**: Esegue mutation, salva risultato
- **Richieste duplicate**: Ritorna risultato cached (stesso input)
- **Input diverso**: Esegue nuova mutation
- **TTL**: 5 minuti di cache
- **Scope**: Solo mutation (query non hanno bisogno di idempotency)

**Endpoint protetti**:

- `auth.login` - Prevenzione doppi login
- `me.changePassword` - Prevenzione doppi cambi password
- `config.set/update` - Prevenzione doppi aggiornamenti config
- `users.create/update` - Prevenzione doppi aggiornamenti utenti

**Nota**: Delete operations non hanno idempotency per sicurezza (delete deve essere esplicito).

### Rate-Limiting Per-Rotta

#### Limiti Configurati

| Procedura         | Max Richieste | Finestra | Key Type |
| ----------------- | ------------- | -------- | -------- |
| auth.login        | 5             | 1 min    | IP       |
| me.changePassword | 3             | 15 min   | userId   |
| users.\*          | 10            | 1 min    | userId   |
| config.set/update | 20            | 1 min    | userId   |

**Errore restituito**: `TOO_MANY_REQUESTS` con messaggio e finestra.

#### Esempi Pratici

**Login rate limiting**:

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

**Output errore**:

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Rate limit exceeded for login. Max 5 requests per 1 minute(s)."
  }
}
```

### Idempotency-Key

#### Header e Formato

**Header**: `Idempotency-Key: <UUID-v4>`

**Procedura supportate**: `create`, `update` mutations.

**Comportamento**:

- Prima richiesta con key → esegue e salva risultato (TTL 5min)
- Richiesta duplicata (stesso body) → ritorna risultato cached (no side-effect)
- Stessa key con body diverso → **409 Conflict**

#### Esempi Pratici

**Creazione utente idempotente**:

```bash
# Prima chiamata: crea utente
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"test","email":"test@test.com","password":"Test123!","role":"viewer"}'

# Seconda chiamata con stessa key → ritorna stesso risultato (no duplicato)
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"test","email":"test@test.com","password":"Test123!","role":"viewer"}'
```

**Conflitto con body diverso**:

```bash
# Prima chiamata
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"user1","email":"user1@test.com","password":"Test123!","role":"viewer"}'

# Seconda chiamata con body diverso → 409 Conflict
curl -X POST http://localhost:3001/trpc/users.create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"username":"user2","email":"user2@test.com","password":"Test123!","role":"viewer"}'
```

**Output conflitto**:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Idempotency-Key already used with different request body. Each key must identify a single operation."
  }
}
```

#### Validazione UUID

**Formato richiesto**: UUID v4 (es. `550e8400-e29b-41d4-a716-446655440000`)

**Esempi validi**:

- `550e8400-e29b-41d4-a716-446655440000`
- `6ba7b810-9dad-11d1-80b4-00c04fd430c8`

**Esempi non validi**:

- `not-a-uuid`
- `550e8400-e29b-41d4-a716` (troppo corto)
- `550e8400-e29b-41d4-a716-446655440000-extra` (troppo lungo)

**Errore formato non valido**:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid Idempotency-Key format. Must be a valid UUID v4."
  }
}
```

#### TTL e Cleanup

- **TTL**: 5 minuti (configurabile via `IDEMPOTENCY_CONFIG.defaultTtlMs`)
- **Cleanup**: Automatico ogni minuto
- **Storage**: In-memory LRU cache (max 1000 keys)
- **Hash**: SHA256(method + path + body) per validazione univoca

#### Best Practices

1. **Genera UUID v4** per ogni operazione unica
2. **Usa stessa key** per retry della stessa operazione
3. **Non riutilizzare key** per operazioni diverse
4. **Gestisci 409 Conflict** nel client (nuova key per operazione diversa)
5. **Non usare per query** (solo mutation hanno bisogno di idempotency)

## 🚧 Prossimi Passi

1. ✅ **Rate Limiting**: Implementato per-rotta
2. ✅ **Idempotency**: Implementato per mutate critiche
3. **Audit Log**: Logging automatico delle azioni
4. **Validazione Input**: Middleware per validazione avanzata
5. **Testing**: Suite di test unitari e integrazione

## 🐛 Troubleshooting

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

## 🔍 Observability

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

## 🏥 Health & Readiness

> 📖 **Documentazione Operativa**: Per troubleshooting dettagliato, esempi di failure scenarios e configurazione Kubernetes, consulta [OPERATIONS.md](../OPERATIONS.md#-readiness--health-checks).

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

## 📝 Note

- Il server usa **SQLite** per sviluppo, **PostgreSQL** per production
- Tutti gli endpoint sono **pubblici** (autenticazione da implementare)
- Le query tRPC usano **GET**, le mutation usano **POST**
- Il formato tRPC è compatibile con client TypeScript end-to-end
