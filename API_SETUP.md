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
curl http://localhost:3001/api/health
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
  -d '{"id":"USER_ID","email":"newemail@example.com","role":"editor"}'
```

#### Elimina Utente (Soft Delete)

```bash
curl -X POST http://localhost:3001/trpc/users.delete \
  -H "Content-Type: application/json" \
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
  -d '{"key":"app.name","value":"Luke","encrypt":false}'
```

#### Imposta Configurazione Cifrata (Solo Admin)

```bash
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"key":"auth.ldap.password","value":"secret-password","encrypt":true}'
```

#### Elimina Configurazione (Solo Admin)

```bash
curl -X POST http://localhost:3001/trpc/config.delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-luke-trace-id: trace-123" \
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

### NextAuth Secret Derivation

- **Algoritmo**: HKDF-SHA256 (RFC 5869)
- **Input**: Master key (~/.luke/secret.key)
- **Parametri**: salt='luke', info='nextauth.secret', length=32 bytes
- **Output**: Base64url string
- **Scope**: Server-only, mai esposto via HTTP

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

Le seguenti chiavi non possono essere eliminate:

- `auth.strategy`, `auth.ldap.url`, `auth.ldap.searchBase`, `auth.ldap.searchFilter`
- `mail.smtp`, `storage.smb`, `storage.drive`
- `nextauth.secret`, `jwt.secret`

#### Formato Chiavi Valido

- **Regex**: `/^[a-z]+([._-][a-z0-9]+)+$/`
- **Esempi validi**: `auth.ldap.url`, `mail.smtp.host`, `storage.smb.password`
- **Esempi non validi**: `app` (manca separatore), `AUTH.ldap` (maiuscole), `auth.` (termina con punto)

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

## 🚧 Prossimi Passi

1. **Autenticazione JWT**: Middleware per proteggere endpoint
2. **Rate Limiting**: Protezione da abusi
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

## 📝 Note

- Il server usa **SQLite** per sviluppo, **PostgreSQL** per production
- Tutti gli endpoint sono **pubblici** (autenticazione da implementare)
- Le query tRPC usano **GET**, le mutation usano **POST**
- Il formato tRPC è compatibile con client TypeScript end-to-end
