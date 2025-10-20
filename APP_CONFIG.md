# Luke - Gestione Configurazioni (AppConfig)

Documentazione dedicata alla gestione centralizzata delle configurazioni del progetto Luke attraverso il sistema AppConfig database-driven.

## Indice

- [Panoramica](#panoramica)
- [Schema delle Chiavi](#schema-delle-chiavi)
- [Policy di Cifratura](#policy-di-cifratura)
- [Gestione Chiavi](#gestione-chiavi)
- [Configurazioni per Categoria](#configurazioni-per-categoria)
- [RBAC e Accesso](#rbac-e-accesso)
- [Audit Log](#audit-log)
- [Best Practices](#best-practices)
- [Riferimenti Correlati](#riferimenti-correlati)

---

## Panoramica

Luke implementa un sistema di configurazione centralizzata che elimina completamente la necessità di file `.env`, utilizzando il database come unica fonte di verità per tutte le configurazioni applicative.

### Caratteristiche Principali

- **Database-driven**: Tutte le configurazioni memorizzate in `AppConfig` table
- **Zero file .env**: Nessun file di configurazione da committare o gestire
- **Cifratura nativa**: AES-256-GCM per segreti sensibili
- **Visualizzazione controllata**: Modalità masked/raw con audit obbligatorio
- **RBAC integrato**: Solo admin possono modificare configurazioni
- **Import/Export sicuro**: Backup e restore con protezione segreti
- **Validazione rigorosa**: Formato chiavi e valori validati

### Vantaggi dell'Approccio Database-Driven

1. **Sicurezza**: Segreti cifrati con master key, mai in plaintext
2. **Tracciabilità**: Ogni modifica loggata in audit trail
3. **Centralizzazione**: Configurazioni condivise tra tutti i servizi
4. **Flessibilità**: Aggiornamenti runtime senza rebuild
5. **Compliance**: Audit log completo per normative

---

## Schema delle Chiavi

Il sistema utilizza 29 chiavi AppConfig organizzate in categorie funzionali.

### Tabella Completa AppConfig

| Categoria        | Chiave                             | Tipo    | Cifrato | Default             | Descrizione               |
| ---------------- | ---------------------------------- | ------- | ------- | ------------------- | ------------------------- |
| **Auth**         | `auth.nextAuthSecret`              | Secret  | ✓       | Random 32 bytes     | NextAuth sessions         |
|                  | `auth.ldap.url`                    | String  | ✓       | -                   | LDAP server URL           |
|                  | `auth.ldap.bindDN`                 | String  | ✓       | -                   | LDAP bind DN              |
|                  | `auth.ldap.bindPassword`           | Secret  | ✓       | -                   | LDAP bind password        |
|                  | `auth.ldap.searchBase`             | String  | ✓       | -                   | LDAP search base          |
|                  | `auth.ldap.searchFilter`           | String  | ✓       | -                   | LDAP search filter        |
|                  | `auth.ldap.groupSearchBase`        | String  | ✓       | -                   | LDAP group base           |
|                  | `auth.ldap.groupSearchFilter`      | String  | ✓       | -                   | LDAP group filter         |
|                  | `auth.ldap.roleMapping`            | JSON    | ✓       | {}                  | LDAP → App role mapping   |
|                  | `auth.strategy`                    | Enum    | -       | `local-first`       | Auth fallback strategy    |
| **App**          | `app.name`                         | String  | -       | `Luke`              | Application name          |
|                  | `app.version`                      | String  | -       | `0.1.0`             | Application version       |
|                  | `app.environment`                  | String  | -       | `development`       | Environment type          |
|                  | `app.locale`                       | String  | -       | `it-IT`             | Default locale            |
|                  | `app.defaultTimezone`              | String  | -       | `Europe/Rome`       | Default timezone          |
|                  | `app.baseUrl`                      | String  | -       | -                   | Base URL for emails       |
| **Security**     | `security.password.minLength`      | Number  | -       | 12                  | Min password length       |
|                  | `security.password.requireUpper`   | Boolean | -       | true                | Require uppercase         |
|                  | `security.password.requireLower`   | Boolean | -       | true                | Require lowercase         |
|                  | `security.password.requireNumber`  | Boolean | -       | true                | Require number            |
|                  | `security.password.requireSpecial` | Boolean | -       | false               | Require special char      |
|                  | `security.tokenVersionCacheTTL`    | Number  | -       | 60000               | Token cache TTL (ms)      |
|                  | `security.cors.developmentOrigins` | CSV     | -       | localhost:3000,5173 | CORS dev origins          |
|                  | `security.session.maxAge`          | Number  | -       | 28800               | Session duration (s)      |
|                  | `security.session.updateAge`       | Number  | -       | 14400               | Session refresh (s)       |
| **Rate Limit**   | `rateLimit`                        | JSON    | -       | Vedi default        | Rate limiting policies    |
| **Integrations** | `integrations.ldap.timeout`        | Number  | -       | 10000               | LDAP timeout (ms)         |
|                  | `integrations.ldap.connectTimeout` | Number  | -       | 5000                | LDAP connect timeout (ms) |
|                  | `integrations.smtp.timeout`        | Number  | -       | 10000               | SMTP timeout (ms)         |
| **On-Demand**    | `mail.smtp.host`                   | String  | ✓       | -                   | SMTP server host          |
|                  | `mail.smtp.port`                   | Number  | ✓       | -                   | SMTP server port          |
|                  | `mail.smtp.secure`                 | Boolean | ✓       | -                   | SMTP use TLS/SSL          |
|                  | `mail.smtp.user`                   | String  | ✓       | -                   | SMTP auth username        |
|                  | `mail.smtp.pass`                   | Secret  | ✓       | -                   | SMTP auth password        |
|                  | `mail.smtp.from`                   | String  | ✓       | -                   | Email sender address      |
|                  | `storage.smb.*`                    | Various | ✓       | -                   | SMB storage config        |
|                  | `storage.drive.*`                  | Various | ✓       | -                   | Drive storage config      |

### Formato Chiavi

Le chiavi seguono il pattern `<categoria>.<nome>[.<sotto-nome>]`:

- **Prefissi validi**: `app`, `auth`, `mail`, `storage`, `security`, `integrations`
- **Regex**: `/^(app|auth|mail|storage|security|integrations)(\.[a-zA-Z0-9_-]+)+$/`
- **Case**: Supporta maiuscole per acronimi (es. `auth.SAML.url`)
- **Separatore**: Sempre punto (`.`)

**Esempi validi**:

- `auth.ldap.url`
- `mail.smtp.host`
- `storage.smb.password`
- `auth.SAML.url`

**Esempi NON validi**:

- `app` (manca sub-chiave)
- `auth.` (termina con punto)
- `invalid.prefix.key` (prefisso non ammesso)

---

## Policy di Cifratura

### Algoritmo e Parametri

Luke utilizza cifratura simmetrica con i seguenti parametri:

- **Algoritmo**: AES-256-GCM (Galois/Counter Mode)
- **Key Length**: 256 bit (32 bytes)
- **IV Length**: 128 bit (16 bytes, random per ogni cifratura)
- **Tag Length**: 128 bit (16 bytes, autenticazione)
- **Encoding**: Base64 per storage in database

### Master Key Management

La master key è il segreto principale da cui derivano tutti gli altri:

- **Posizione**: `~/.luke/secret.key`
- **Permessi**: 0600 (solo owner read/write)
- **Lunghezza**: 32 bytes (256 bit)
- **Generazione**: Automatica al primo avvio se assente
- **Scope**: Server-only, mai esposta via HTTP

### Derivazione Segreti HKDF-SHA256

Luke utilizza HKDF (HMAC-based Key Derivation Function) per derivare segreti specifici dalla master key:

```typescript
// Parametri HKDF
const hkdf = {
  salt: 'luke',
  length: 32, // 256 bit
};

// Domini isolati
const domains = {
  'api.jwt': 'JWT API backend',
  'nextauth.secret': 'NextAuth web sessions',
  'cookie.secret': 'Fastify signed cookies',
};
```

**Vantaggi**:

- Ogni dominio ha un segreto indipendente
- Compromissione di un segreto non impatta gli altri
- Rotazione master key invalida tutti i derivati
- Nessun segreto salvato in database

### Cifratura Configurazioni

Le configurazioni sensibili vengono cifrate prima dello storage:

1. **Plaintext** → UTF-8 bytes
2. **IV random** generato (16 bytes)
3. **Cifratura AES-256-GCM** con master key
4. **Tag autenticazione** calcolato (16 bytes)
5. **Storage** in formato: `iv:ciphertext:tag` (Base64)

**Decifratura**:

1. Parse formato `iv:ciphertext:tag`
2. Verifica tag autenticazione
3. Decifratura con master key e IV
4. UTF-8 bytes → Plaintext

---

## Gestione Chiavi

### Creazione e Modifica

#### Endpoint tRPC Disponibili

| Procedura            | Input                              | Output            | Descrizione                    |
| -------------------- | ---------------------------------- | ----------------- | ------------------------------ |
| `config.set`         | `{key, value, encrypt?}`           | `{key, value}`    | Crea o aggiorna configurazione |
| `config.update`      | `{key, value, encrypt?}`           | `{key, value}`    | Alias di set (same behavior)   |
| `config.delete`      | `{key}`                            | `{success: true}` | Elimina configurazione         |
| `config.setMultiple` | `{items: [{key, value, encrypt}]}` | `{successCount}`  | Batch creation/update          |

#### Esempio Creazione

```bash
# Configurazione pubblica
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"key":"app.name","value":"Luke","encrypt":false}'

# Configurazione cifrata
curl -X POST http://localhost:3001/trpc/config.set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"key":"auth.ldap.password","value":"secret","encrypt":true}'
```

### Visualizzazione Sicura

#### Modalità Disponibili

Luke implementa due modalità di visualizzazione per proteggere i segreti:

| Modalità | Accesso      | Valori Cifrati | Audit Log | Use Case                      |
| -------- | ------------ | -------------- | --------- | ----------------------------- |
| `masked` | Tutti utenti | `[ENCRYPTED]`  | No        | Listing, verifica chiavi      |
| `raw`    | Solo admin   | Plaintext      | Sì        | Debug, export, configurazione |

#### Principio "Mai Decrypt in Bulk"

**Regola fondamentale**: La lista configurazioni (`config.list`) non restituisce mai valori in chiaro per chiavi cifrate, anche per admin.

**Motivazione**:

- Prevenire leak accidentali in log
- Ridurre superficie attacco
- Audit granulare per ogni accesso
- Conformità normative (GDPR, PCI-DSS)

#### Esempi Visualizzazione

**Modalità Masked** (qualsiasi utente):

```bash
curl "http://localhost:3001/trpc/config.viewValue?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"auth.ldap.password",mode:"masked"})))')"
```

Output:

```json
{
  "key": "auth.ldap.password",
  "value": "[ENCRYPTED]",
  "isEncrypted": true,
  "mode": "masked"
}
```

**Modalità Raw** (solo admin):

```bash
curl -H "Authorization: Bearer TOKEN" \
     -H "x-luke-trace-id: trace-123" \
     "http://localhost:3001/trpc/config.viewValue?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({key:"auth.ldap.password",mode:"raw"})))')"
```

Output:

```json
{
  "key": "auth.ldap.password",
  "value": "my-secret-password",
  "isEncrypted": true,
  "mode": "raw"
}
```

### Protezione Chiavi Critiche

Le seguenti chiavi sono **protette contro eliminazione** per garantire funzionamento del sistema:

**Autenticazione**:

- `auth.strategy`
- `auth.ldap.url`
- `auth.ldap.searchBase`
- `auth.ldap.searchFilter`
- `nextauth.secret`
- `jwt.secret`

**Sicurezza**:

- `security.encryption.key`

**Servizi Esterni**:

- `mail.smtp`
- `storage.smb`
- `storage.drive`

**Comportamento**: Tentativo di eliminazione restituisce `409 CONFLICT`.

### Import/Export

#### Export JSON Sicuro

L'export configurazioni protegge i segreti mostrando sempre `[ENCRYPTED]`:

```bash
# Export solo metadata
curl -X POST "http://localhost:3001/trpc/config.exportJson" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{"includeValues":false}'

# Export con valori (segreti mascherati)
curl -X POST "http://localhost:3001/trpc/config.exportJson" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{"includeValues":true}'
```

Output:

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

#### Import JSON

L'import supporta batch creation/update con validazione:

```bash
curl -X POST "http://localhost:3001/trpc/config.importJson" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-luke-trace-id: trace-123" \
  -d '{
    "items": [
      {"key":"app.name","value":"Luke","encrypt":false},
      {"key":"auth.ldap.url","value":"ldaps://example.com","encrypt":true},
      {"key":"auth.ldap.password","value":null,"encrypt":true}
    ]
  }'
```

**Comportamento**:

- `value: null` → skip (mantiene valore esistente)
- `encrypt: true` → cifra prima di salvare
- Validazione formato chiavi
- Rollback automatico su errori critici

Output:

```json
{
  "successCount": 2,
  "errorCount": 0,
  "errors": []
}
```

---

## Configurazioni per Categoria

### Auth

Configurazioni per autenticazione e autorizzazione.

#### NextAuth Secret

```typescript
key: 'auth.nextAuthSecret';
type: Secret;
encrypted: true;
default: crypto.randomBytes(32);
```

Derivato automaticamente dalla master key via HKDF-SHA256, non salvato in database.

#### LDAP

Parametri per autenticazione enterprise LDAP:

```json
{
  "auth.ldap.url": "ldaps://ldap.example.com",
  "auth.ldap.bindDN": "cn=admin,dc=example,dc=com",
  "auth.ldap.bindPassword": "[ENCRYPTED]",
  "auth.ldap.searchBase": "ou=users,dc=example,dc=com",
  "auth.ldap.searchFilter": "(uid={{username}})",
  "auth.ldap.groupSearchBase": "ou=groups,dc=example,dc=com",
  "auth.ldap.groupSearchFilter": "(member={{dn}})",
  "auth.ldap.roleMapping": {
    "cn=admins,ou=groups,dc=example,dc=com": "admin",
    "cn=editors,ou=groups,dc=example,dc=com": "editor",
    "cn=users,ou=groups,dc=example,dc=com": "viewer"
  }
}
```

#### Strategia Autenticazione

```typescript
key: 'auth.strategy';
type: Enum;
values: ['local-first', 'ldap-first', 'local-only', 'ldap-only'];
default: 'local-first';
```

- **local-first**: Prova locale → fallback LDAP
- **ldap-first**: Prova LDAP → fallback locale (solo errori infrastrutturali)
- **local-only**: Solo autenticazione locale
- **ldap-only**: Solo autenticazione LDAP

### App

Metadati applicazione e localizzazione.

```json
{
  "app.name": "Luke",
  "app.version": "0.1.0",
  "app.environment": "development",
  "app.locale": "it-IT",
  "app.defaultTimezone": "Europe/Rome",
  "app.baseUrl": "https://luke.example.com"
}
```

### Security

Policy sicurezza, sessioni e CORS.

#### Password Policy

```json
{
  "security.password.minLength": 12,
  "security.password.requireUpper": true,
  "security.password.requireLower": true,
  "security.password.requireNumber": true,
  "security.password.requireSpecial": false
}
```

#### Session Management

```json
{
  "security.session.maxAge": 28800,
  "security.session.updateAge": 14400,
  "security.tokenVersionCacheTTL": 60000
}
```

#### CORS

```json
{
  "security.cors.developmentOrigins": "http://localhost:3000,http://localhost:5173"
}
```

### Rate Limit

Policy di rate limiting per-rotta (formato JSON):

```json
{
  "rateLimit": {
    "login": { "max": 5, "timeWindow": "1m", "keyBy": "ip" },
    "passwordChange": { "max": 3, "timeWindow": "15m", "keyBy": "userId" },
    "configMutations": { "max": 20, "timeWindow": "1m", "keyBy": "userId" },
    "userMutations": { "max": 10, "timeWindow": "1m", "keyBy": "userId" }
  }
}
```

### Integrations

Timeout e parametri connessione per servizi esterni.

```json
{
  "integrations.ldap.timeout": 10000,
  "integrations.ldap.connectTimeout": 5000,
  "integrations.smtp.timeout": 10000
}
```

### On-Demand

Configurazioni create dinamicamente dall'admin.

#### SMTP (Email)

```json
{
  "mail.smtp.host": "smtp.gmail.com",
  "mail.smtp.port": 587,
  "mail.smtp.secure": false,
  "mail.smtp.user": "noreply@example.com",
  "mail.smtp.pass": "[ENCRYPTED]",
  "mail.smtp.from": "noreply@example.com"
}
```

#### Storage (SMB/Drive)

Configurazioni storage cifrate create on-demand per integrazioni file storage.

---

## RBAC e Accesso

### Role-Based Access Control

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

### Frontend Protection

- **Route `/settings/*`**: Solo amministratori possono accedere
- **Middleware Next.js**: Verifica ruolo prima di servire pagina
- **Form Reset**: Configurazioni si resettano al cambio sessione (logout/login)

---

## Audit Log

### Eventi Tracciati

Ogni operazione critica genera un evento audit con metadati redatti:

| Evento              | Metadati Loggati                                        |
| ------------------- | ------------------------------------------------------- |
| `CONFIG_VIEW_VALUE` | `{ key, mode: 'raw' }`                                  |
| `CONFIG_CREATE`     | `{ key, isEncrypted, valueRedacted }`                   |
| `CONFIG_UPDATE`     | `{ key, isEncrypted, valueRedacted }`                   |
| `CONFIG_DELETE`     | `{ key }`                                               |
| `CONFIG_EXPORT`     | `{ includeValues, count }`                              |
| `CONFIG_IMPORT`     | `{ key, isEncrypted, valueRedacted, source: 'import' }` |

### Redazione Automatica

I valori sensibili vengono redatti prima del logging:

```typescript
function redact(value: string, maxLength = 32): string {
  if (value.length <= maxLength) {
    return '[REDACTED]';
  }
  return value.substring(0, maxLength) + '... [TRUNCATED]';
}
```

**Campi sempre redatti**:

- Password (mostrano sempre `[ENCRYPTED]`)
- Token e API keys (prime 10 caratteri + `...`)
- Segreti cifrati (sempre `[ENCRYPTED]`)

### Tracing Distribuito

Ogni richiesta include header `x-luke-trace-id` per correlazione log:

```bash
curl -H "x-luke-trace-id: trace-abc-123" \
     -H "Authorization: Bearer TOKEN" \
     "http://localhost:3001/trpc/config.viewValue?..."
```

**Log output**:

```json
{
  "level": "info",
  "time": 1705320600000,
  "pid": 12345,
  "hostname": "luke-api",
  "traceId": "trace-abc-123",
  "msg": "CONFIG_VIEW_VALUE",
  "metadata": {
    "key": "auth.ldap.password",
    "mode": "raw"
  }
}
```

---

## Best Practices

### Rotazione Segreti

**Frequenza**: Ogni 90 giorni o in caso di compromissione.

**Procedura**:

1. **Backup configurazioni**:

   ```bash
   curl -X POST http://localhost:3001/trpc/config.exportJson \
     -H "Authorization: Bearer TOKEN" \
     -d '{"includeValues":true}' > backup.json
   ```

2. **Genera nuova master key**:

   ```bash
   mv ~/.luke/secret.key ~/.luke/secret.key.backup
   # Riavvia server: genera automaticamente nuova key
   ```

3. **Aggiorna configurazioni cifrate**:
   - Reimposta password LDAP
   - Reimposta credenziali SMTP
   - Reimposta storage credentials

4. **Verifica funzionamento**:

   ```bash
   # Test LDAP
   curl -X POST http://localhost:3001/trpc/integrations.testLdap

   # Test SMTP
   curl -X POST http://localhost:3001/trpc/integrations.testSmtp
   ```

### Backup Configurazioni

**Strategia consigliata**: Export giornaliero automatico con retention 30 giorni.

```bash
#!/bin/bash
# backup-config.sh
DATE=$(date +%Y%m%d)
curl -X POST http://localhost:3001/trpc/config.exportJson \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "x-luke-trace-id: backup-$DATE" \
  -d '{"includeValues":true}' > "config-backup-$DATE.json"

# Retention: rimuovi backup > 30 giorni
find . -name "config-backup-*.json" -mtime +30 -delete
```

**Cron job**:

```cron
0 2 * * * /path/to/backup-config.sh
```

### Testing Configurazioni

Prima di salvare configurazioni critiche, testarle:

#### Test SMTP

```bash
curl -X POST http://localhost:3001/trpc/integrations.testSmtp \
  -H "Authorization: Bearer TOKEN" \
  -d '{"recipient":"test@example.com"}'
```

#### Test LDAP

```bash
# Test connessione
curl -X POST http://localhost:3001/trpc/integrations.testLdap \
  -H "Authorization: Bearer TOKEN" \
  -d '{"testType":"connection"}'

# Test ricerca utenti
curl -X POST http://localhost:3001/trpc/integrations.testLdap \
  -H "Authorization: Bearer TOKEN" \
  -d '{"testType":"search","username":"testuser"}'
```

### Monitoraggio

**Metriche da monitorare**:

- Numero accessi raw per admin (threshold: max 10/giorno)
- Errori decifratura (threshold: 0, indica corruzione dati)
- Modifiche configurazioni critiche (alert immediato)
- Export configurazioni (solo da IPs autorizzati)

**Alert da configurare**:

```yaml
alerts:
  - name: config_raw_access_spike
    condition: count(CONFIG_VIEW_VALUE.mode=raw) > 10 in 1h
    severity: warning

  - name: config_decrypt_error
    condition: count(CONFIG_DECRYPT_ERROR) > 0
    severity: critical

  - name: config_critical_change
    condition: CONFIG_UPDATE.key in [auth.strategy, jwt.secret]
    severity: warning
```

### Sicurezza

**Checklist**:

- [ ] Master key con permessi 0600
- [ ] Backup configurazioni cifrati e protetti
- [ ] Audit log abilitato e monitorato
- [ ] Solo admin possono accedere a `/settings/*`
- [ ] Rate limiting attivo su endpoint config
- [ ] HTTPS obbligatorio in produzione
- [ ] Rotazione segreti schedulata
- [ ] Test periodici LDAP/SMTP

---

## Riferimenti Correlati

- [README.md](README.md) - Documentazione principale del progetto
- [API_SETUP.md](API_SETUP.md) - Setup e utilizzo API con esempi endpoint
- [OPERATIONS.md](OPERATIONS.md) - Parametri runtime e configurazioni per ambiente
- [SETUP_STATUS.md](SETUP_STATUS.md) - Registro tecnico interno e roadmap

---

**Luke** - Sistema di configurazione centralizzata per applicazioni enterprise sicure
