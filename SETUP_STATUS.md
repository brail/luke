# Luke Monorepo - Status Setup

## ✅ Completato con Successo

### 🏗️ Struttura Monorepo

- ✅ **pnpm workspaces** configurato (`pnpm-workspace.yaml`)
- ✅ **Turborepo** configurato (`turbo.json`) con pipeline build/dev/lint
- ✅ **TypeScript** strict mode configurato
- ✅ **ESLint + Prettier + Husky** pre-commit hooks
- ✅ **Node.js v20** specificato (`.nvmrc`)

### 📦 Workspaces

- ✅ **@luke/web** (Next.js 15 + Tailwind CSS)
- ✅ **@luke/api** (Fastify 5 + tRPC + Prisma)
- ✅ **@luke/core** (Zod schemas + RBAC + utils)

### 🚀 Servizi Attivi

- ✅ **Frontend**: http://localhost:3000 (Next.js 15 + Tailwind CSS)
- ✅ **API**: http://localhost:3001 (Fastify 5) - risponde `{"message":"Luke API is running!"}`

### 🛠️ Comandi Funzionanti

```bash
pnpm install          # ✅ Installa dipendenze
pnpm build            # ✅ Build tutti i workspace
pnpm dev              # ✅ Avvia tutto in dev mode
pnpm deps:latest      # ✅ Aggiorna dipendenze
pnpm lint             # ✅ Lint tutti i file
pnpm format           # ✅ Formatta con Prettier
```

### 🔐 Sicurezza Configurata

- ✅ **Nessun .env** - configurazioni in database
- ✅ **Master key** - keytar + fallback `~/.luke/secret.key`
- ✅ **RBAC** - Role-based access control in `@luke/core`
- ✅ **RBAC Guards** - Middleware riusabili (`withRole`, `roleIn`, `adminOnly`)
- ✅ **JWT Strategy** - HS256+HKDF con clock tolerance ±60s
- ✅ **Rate Limiting** - Due livelli (globale 100/min, critico 10/min)
- ✅ **Idempotency** - In-memory LRU cache per mutazioni critiche
- ✅ **CSP Strict** - Content Security Policy senza 'unsafe-inline'
- ✅ **Cookie Security** - `httpOnly`, `secure`, `sameSite=strict`
- ✅ **Audit log** - logging completo delle mutazioni
- ✅ **Segreti centralizzati** - JWT_SECRET e NEXTAUTH_SECRET in AppConfig cifrati
- ✅ **Error handling uniforme** - TRPCError in tutti i router
- ✅ **LDAP enterprise authentication** - con role mapping e strategia configurabile
- ✅ **Principio "mai decrypt in bulk"** - implementato nel config router
- ✅ **Paginazione e filtri** - per config.list con output strutturato
- ✅ **Visualizzazione sicura** - con modalità masked/raw e audit log
- ✅ **Email transazionali** - reset password e verifica email con token hash SHA-256

## ⚠️ Note

### Frontend (Next.js)

- ✅ **Tailwind CSS** configurato e funzionante
- ✅ **Pagina not-found** personalizzata funzionante
- ⚠️ **Pagina principale** - attualmente mostra not-found (normale per setup iniziale)

### API (Fastify)

- ✅ **Server** attivo e funzionante
- ✅ **Logging** con Pino configurato
- ✅ **tRPC + Prisma** dipendenze installate

### Core Package

- ✅ **Zod schemas** per User, AppConfig, RBAC
- ✅ **TypeScript** strict mode
- ✅ **Build** funzionante

## 🔐 Gestione Segreti

### Processo Seed

```bash
# Genera segreti JWT e NextAuth automaticamente
pnpm --filter @luke/api run seed
```

### Segreti Generati

- **auth.nextAuthSecret**: 32 bytes random, cifrato con AES-256-GCM
- **Master key**: `~/.luke/secret.key` (creata automaticamente)
- **JWT secret**: Derivato via HKDF-SHA256 dalla master key (non in DB)

### Configurazioni AppConfig (29 totali)

| Categoria        | Chiavi                                                                            | Cifrato  | Uso                     |
| ---------------- | --------------------------------------------------------------------------------- | -------- | ----------------------- |
| **Auth**         | `auth.nextAuthSecret`, `auth.ldap.*`, `auth.strategy`                             | Parziale | Autenticazione          |
| **App**          | `app.name`, `app.version`, `app.environment`, `app.locale`, `app.defaultTimezone` | -        | Metadati app            |
| **Security**     | `security.password.*`, `security.session.*`, `security.cors.*`                    | -        | Policy sicurezza        |
| **Rate Limit**   | `rateLimit` (JSON)                                                                | -        | Politiche rate limiting |
| **Integrations** | `integrations.ldap.*`, `integrations.smtp.*`                                      | -        | Timeout connessioni     |
| **On-Demand**    | `mail.smtp`, `storage.*`                                                          | ✓        | Configurazioni admin    |

### Configurazioni LDAP

- **Parametri server LDAP**: url, bindDN, bindPassword, searchBase, searchFilter, groupSearchBase, groupSearchFilter (tutti cifrati)
- **Role mapping JSON**: mappa gruppi LDAP a ruoli app (admin/editor/viewer)
- **Strategia autenticazione**: local-first, ldap-first, local-only, ldap-only
- **Timeout configurabili**: `integrations.ldap.timeout` (10s), `integrations.ldap.connectTimeout` (5s)

### Rotazione Segreti

1. Aggiorna i valori in AppConfig tramite UI o direttamente nel DB
2. Riavvia il server per applicare le modifiche
3. I segreti vengono caricati in cache all'avvio per performance

### Verifica Sicurezza

- ✅ Nessun file `.env` committato nel repository
- ✅ Tutti i segreti sono cifrati in AppConfig
- ✅ Master key protetta con permessi 600
- ✅ Cache in-memory per performance (nessuna query DB per ogni token)

## 🔐 Autenticazione LDAP

### Configurazione Enterprise

Luke supporta autenticazione enterprise via LDAP con le seguenti funzionalità:

- **Configurazione parametri server**: URL, Bind DN, Search Base, Search Filter
- **Mapping gruppi-ruoli**: JSON per mappare gruppi LDAP a ruoli app (admin/editor/viewer)
- **Strategia fallback configurabile**:
  - `local-first`: prova locale, poi LDAP
  - `ldap-first`: prova LDAP, poi locale
  - `local-only`: solo autenticazione locale
  - `ldap-only`: solo autenticazione LDAP
- **Test connessione**: endpoint per verificare configurazione LDAP
- **UI dedicata**: pagina `/settings/ldap` per configurazione completa

### Configurazione

1. Accedi alla pagina `/settings/ldap` come admin
2. Configura i parametri del server LDAP
3. Imposta il mapping dei gruppi ai ruoli in formato JSON
4. Testa la connessione prima di salvare
5. Scegli la strategia di autenticazione appropriata

### Sicurezza

- Tutti i parametri sensibili (bindDN, bindPassword) sono cifrati in AppConfig
- Validazione input per prevenire LDAP injection
- Audit log completo delle operazioni LDAP
- Fallback graceful in caso di errori di connessione

### Sincronizzazione Utenti

- **Automatica**: Gli attributi utente (username, password) vengono sincronizzati ad ogni login LDAP
- **Campi protetti**: Nel frontend, i campi sincronizzati sono disabilitati per utenti esterni
- **Campi preservati**: Email e ruolo modificati manualmente non vengono sovrascritti dalla sincronizzazione
- **Indicatore visivo**: Nota "Campo sincronizzato esternamente" sotto ogni campo disabilitato
- **Colonna Provider**: La tabella utenti mostra il provider di ogni utente (LOCAL/LDAP/OIDC)

## 📧 Email Transazionali

### Flussi Implementati

Luke supporta email transazionali per due flussi di sicurezza essenziali:

#### Reset Password

- **Endpoint tRPC**: `auth.requestPasswordReset`, `auth.confirmPasswordReset`
- **Validità token**: 30 minuti
- **URL frontend**: `/auth/reset?token={token}`
- **Sicurezza**: Token hash SHA-256, una-tantum, invalida sessioni attive dopo reset
- **Rate limiting**: max 3 richieste ogni 15 minuti per IP

#### Verifica Email

- **Endpoint tRPC**: `auth.requestEmailVerification`, `auth.confirmEmailVerification`
- **Validità token**: 24 ore
- **URL frontend**: `/auth/verify?token={token}`
- **Configurazione**: `auth.requireEmailVerification` (default: false)
- **Applicabilità**: Solo utenti LOCAL (LDAP/OIDC autenticati esternamente)

### Configurazione SMTP Richiesta

Configurare in `AppConfig` le seguenti chiavi:

```
smtp.host         # es. smtp.gmail.com
smtp.port         # es. 587 (STARTTLS) o 465 (SSL/TLS)
smtp.secure       # true per SSL/TLS, false per STARTTLS
smtp.user         # username autenticazione
smtp.pass         # password (cifrata AES-256-GCM)
smtp.from         # indirizzo mittente
app.baseUrl       # URL base per link nelle email
```

### Sicurezza Token

- **Token 32 byte random** (64 caratteri hex)
- **Solo hash SHA-256 in DB**, mai token in chiaro
- **Token usa-e-getta**: eliminato automaticamente dopo uso o scadenza
- **Nessun PII in AuditLog**: logging sicuro senza email/token
- **Eventi auditati**: `PASSWORD_RESET_REQUESTED`, `PASSWORD_CHANGED`, `EMAIL_VERIFICATION_SENT`, `EMAIL_VERIFIED`

### Template Email

Template HTML + testo plain minimali inline in `apps/api/src/lib/mailer.ts`. Personalizzabili senza dipendenze esterne.

### DNS Raccomandazioni (Produzione)

Per deliverability ottimale configurare:

- **SPF Record**: Autorizza server SMTP
- **DKIM**: Firma digitale autenticità
- **DMARC**: Policy anti-spoofing (opzionale)

## 🔐 Gestione Configurazioni Sensibili

### Visualizzazione Valori Cifrati

I valori cifrati non vengono mai mostrati in chiaro nella lista configurazioni per motivi di sicurezza:

- **Lista configurazioni**: `config.list` restituisce `valuePreview: null` per valori cifrati
- **Modalità visualizzazione**:
  - `masked`: per tutti, cifrati mostrano `[ENCRYPTED]`
  - `raw`: solo admin, decritta e genera audit log
- **Modifica configurazione**: per aggiornare un valore cifrato, è necessario reinserirlo completamente nel form
- **Indicatore visivo**: la colonna "Cifrato" indica se il valore è protetto con AES-256-GCM
- **Tracing**: Ogni accesso raw viene tracciato con `x-luke-trace-id` per compliance

### Configurazione LDAP

**IMPORTANTE: Le configurazioni LDAP sono GLOBALI per l'applicazione**

- **Natura globale**: Tutte le configurazioni LDAP sono salvate con chiavi globali (`auth.ldap.*`) nel database
- **Accesso uniforme**: Tutti gli amministratori vedono e modificano la stessa configurazione LDAP
- **Nessuna configurazione per-utente**: Non esistono configurazioni LDAP specifiche per singoli utenti
- **Reset automatico**: Al cambio di sessione (logout/login), il form si resetta completamente
- **Protezione accesso**: Solo gli amministratori possono accedere alla pagina `/settings/ldap`

Il campo `bindPassword` nella configurazione LDAP è opzionale:

- **Nuovo setup**: inserire la password per creare la configurazione
- **Aggiornamento parametri**: lasciare vuoto il campo password per mantenerla invariata
- **Cambio password**: inserire la nuova password per aggiornarla
- **Placeholder**: `••••••` indica che una password è già salvata e cifrata

### Protezioni Amministrative

- **Auto-eliminazione**: Gli admin non possono eliminare o disabilitare il proprio account
- **Ultimo admin**: Protezione contro l'eliminazione dell'ultimo amministratore del sistema
- **Robustezza CRUD**: Validazioni avanzate per prevenire operazioni pericolose

## 🔐 Security Hardening Completato

### JWT & Authentication

- ✅ **HS256 esplicito** con secret derivato via HKDF-SHA256
- ✅ **Claim standard** (`iss`, `aud`, `exp`, `nbf`) con clock tolerance ±60s
- ✅ **Helper centralizzati** (`signJWT`, `verifyJWT`) in `apps/api/src/lib/jwt.ts`
- ✅ **Cookie secret** derivato via HKDF-SHA256 dalla master key (dominio: `cookie.secret`)

### RBAC Guards

- ✅ **Middleware riusabili** (`withRole`, `roleIn`, `adminOnly`, `adminOrEditor`)
- ✅ **Composizione type-safe** per logica complessa
- ✅ **Esportati** da `apps/api/src/lib/trpc.ts` per uso nei router

### Rate Limiting

- ✅ **Due livelli**: Globale (100 req/min) + Critico (10 req/min)
- ✅ **Endpoint critici**: users, config, auth mutations
- ✅ **Dev mode**: Limiti permissivi (1000/100 req/min)
- ✅ **Configurabile** via AppConfig `rateLimit` (JSON) con fallback hardcoded

### Idempotency

- ✅ **In-memory LRU cache** (max 1000 keys, TTL 5min)
- ✅ **Header**: `Idempotency-Key: <uuid-v4>`
- ✅ **Hash validation**: SHA256(method + path + body)
- ✅ **Scope**: Mutazioni critiche (users, config)

### CSP & Headers

- ✅ **CSP strict** senza 'unsafe-inline' in scriptSrc
- ✅ **HSTS** con maxAge 1 anno, includeSubDomains, preload
- ✅ **Cookie security**: `httpOnly`, `secure`, `sameSite=strict`

### Roadmap Futura

- 🔜 **CSP nonce-based** per eliminare completamente 'unsafe-inline'
- 🔜 **Redis store** per idempotency in cluster multi-processo
- 🔜 **Rate limit per utente** oltre che per IP

## 🎨 UI Settings Standard (DRY)

### Componenti Riusabili Implementati

Luke implementa un sistema standardizzato di componenti DRY per pagine di configurazione:

- ✅ **SettingsFormShell**: Wrapper uniforme con gestione loading/error automatica
- ✅ **SettingsActions**: Bottoni azione standardizzati (Save + Test) con stati pending
- ✅ **SensitiveField**: Campo password sicuro con toggle show/hide e placeholder mascherato
- ✅ **TestStatusBanner**: Banner uniforme per risultati test (success/error/idle)
- ✅ **KeyValueGrid**: Grid responsive per layout uniforme campi form
- ✅ **FeatureToggleCard**: Card per toggle abilitazione feature

### Pattern Standardizzati

- ✅ **React Hook Form + Zod**: Validazione end-to-end uniforme
- ✅ **Schema centralizzati**: `mailSmtpConfigSchema`, `ldapConfigSchema` in `@luke/core`
- ✅ **Toast uniformi**: Success/Error messaggi coerenti
- ✅ **Gestione segreti**: `hasValue` flag, mai mostrare valori in chiaro
- ✅ **Accessibilità**: `aria-busy`, `role="status"`, `aria-live="polite"`

### Pagine Migrate

- ✅ **Mail Settings** (`/settings/mail`): Migrata a RHF+Zod con componenti DRY
- ✅ **LDAP Settings** (`/settings/ldap`): Refactor con componenti DRY e Dialog per test ricerca

### Documentazione

- ✅ **README.md**: Sezione completa "UI Settings Standard" con esempi
- ✅ **SETUP_STATUS.md**: Checkpoint standard DRY completato

## 🎯 Prossimi Passi

Il monorepo è **pronto per lo sviluppo**! Puoi procedere con:

1. **Frontend**: Sviluppare componenti e pagine principali
2. **API**: Implementare tRPC routers e logica business
3. **Database**: Configurare Prisma schema e migrations
4. **UI**: Aggiungere componenti shadcn/ui

## 📋 Verifiche Manuali

```bash
# Test Frontend
curl http://localhost:3000

# Test API
curl http://localhost:3001

# Test Health Check
curl http://localhost:3001/api/health

# Build completo
pnpm build

# Lint
pnpm lint

# Test Seed (genera segreti)
pnpm --filter @luke/api run seed

# Verifica segreti in DB
pnpm --filter @luke/api prisma:studio
```

---

**Status**: ✅ **BOOTSTRAP COMPLETATO** - Pronto per sviluppo! 🚀
