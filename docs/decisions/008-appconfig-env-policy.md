# ADR-008 — AppConfig KV System e Env Policy

## Status

Accepted

## Contesto

Il progetto ha bisogno di gestire configurazioni applicative sensibili (credenziali SMTP, bind LDAP, endpoint storage, token OAuth, `app.baseUrl`) in modo sicuro, senza esporle in file `.env` che finirebbero in versione o nei log di deploy.

Le env var tradizionali presentano problemi strutturali:
- Richiedono rebuild o restart per ogni cambio
- Finiscono facilmente in log, dump di processo, export CI
- Non supportano cifratura nativa
- Non hanno audit trail

Al contempo, alcune variabili **devono** stare in `.env` per vincoli di framework: Prisma richiede `DATABASE_URL` prima del boot DB, NextAuth richiede `NEXTAUTH_SECRET` a compile-time, Next.js bake `NEXT_PUBLIC_*` nel bundle client.

## Decisione

Separazione netta tra **bootstrap infrastrutturale** (`.env`) e **configurazione applicativa** (AppConfig su PostgreSQL).

### `.env` ammette solo

**API**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`, `LUKE_CORS_ALLOWED_ORIGINS`, `OTEL_*`, `LOG_LEVEL`

**Web**: `INTERNAL_API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `COOKIE_SECURE`

### AppConfig (tabella KV PostgreSQL)

Tutto il resto vive in `AppConfig` come coppie `key → value` (stringa). `AppConfigRegistry` in `packages/core/src/schemas/config.ts` è la single source of truth: ogni chiave ha schema Zod, tipo e flag `sensitive`.

- Valori sensibili cifrati con AES-256-GCM (master key `~/.luke/secret.key`)
- Lettura via `getConfigValue(prisma, key)` o tRPC config router
- Nessun `process.env.*` nel codice applicativo

### Enforcement automatico

`assertEnvPolicy()` in `apps/api/src/server.ts` blocca il boot in produzione se trova pattern vietati: `SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`.

- **Produzione**: `process.exit(1)` — il server non parte
- **Sviluppo**: warning esplicito in console

## Conseguenze

- Ogni nuova chiave di configurazione richiede aggiornamento di `AppConfigRegistry` con schema Zod — non si può aggiungere config "di nascosto"
- I deploy non hanno segreti applicativi nelle env var di container/Portainer
- L'audit trail di ogni cambio configurazione è garantito dal router tRPC `config.*`
- Se il DB non è raggiungibile al boot, la configurazione applicativa non è disponibile — il server fa fail-fast
- `assertEnvPolicy()` va aggiornato se si aggiungono pattern di env var vietati non ancora coperti
