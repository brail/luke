# Lessons Log

Regole nate da correzioni ricevute durante lo sviluppo. Ogni volta che Claude
viene corretto, aggiunge qui una regola per non ripetere l'errore
(vedi CLAUDE.md → Regole di ingaggio).

Formato: `## <regola in una riga>` sotto la categoria giusta, con contesto,
root cause e fix. Nuove categorie ammesse quando serve.

---

## TypeScript & Next.js

### `as any` vietato — usare `as Route` per redirect con typedRoutes

Con `typedRoutes: true` in `next.config.js`, `redirect()` richiede un tipo `Route`.
Per path validi a runtime ma non nel manifest statico (es. route group `(app)`), usare:

```typescript
import type { Route } from 'next';
redirect('/app/dashboard' as Route);
```

Mai `as any` — viola strict mode. Pattern già usato in `NotificationDropdown.tsx`.

---

## Prisma & PostgreSQL

### Soft-delete + slug uniqueness: usare partial index PostgreSQL

Quando un modello ha soft-delete (`isActive: Boolean`) e uno slug che deve restare unico tra i record attivi, la soluzione corretta è un **partial unique index PostgreSQL**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "company_functions_slug_active_key"
  ON "company_functions"("slug") WHERE "isActive" = true;
```

Prisma non supporta partial indexes nel DSL — va aggiunto a mano nella migration SQL.
Rimuovere `@unique` dallo slug in schema.prisma e aggiungere `@@index([slug])` per le query.

Nel router aggiungere guard esplicita in `create` (distingue slug-attivo vs slug-disattivato con messaggio chiaro) e procedure `restore` con anti-collision check.

**Alternativa DB-agnostica** (se mai si cambia DB): al soft-delete, nullare lo slug e salvarlo in `slugOriginal`. `NULL != NULL` in SQL → `@unique` funziona su tutti i DB. Per ora over-engineering: il progetto è locked su PostgreSQL.

### `prisma migrate deploy` su DB dev locale può bloccarsi per drift con `db push`

Il workflow per nuove migration usa `db push` (porta 5432) — questo NON scrive su
`_prisma_migrations`. Se in passato è stato lanciato `migrate deploy` sullo stesso DB,
può fallire a metà lasciando una riga `finished_at = NULL` che blocca ogni deploy successivo.

Diagnosi e fix completi: `docs/prisma-migration-workflow.md` → Troubleshooting.
Regola: mai `resolve --applied` senza aver verificato che il DB rifletta davvero quello stato.

---

## tRPC & Fastify

### tRPC 11.18 + Fastify: UNSUPPORTED_MEDIA_TYPE / Unable to transform

**Problema**: upgrade tRPC 11.8→11.18 introduce protocollo streaming JSONL (`trpc-accept: application/jsonl`). Sia `httpBatchLink` che `httpBatchStreamLink` danno errori runtime.

**Root cause**: tRPC 11.18 aggiunge `isDataStream()` check — lancia `UNSUPPORTED_MEDIA_TYPE` se una procedura ritorna un oggetto con valori `Promise` o `AsyncIterable` in path non-streaming. Il Fastify custom content-type parser interferisce con `incomingMessageToRequest`.

**Fix**: usare `httpBatchStreamLink` (import da `@trpc/client`, non `@trpc/react-query`) + aggiungere `trpc-accept: application/jsonl` esplicito nelle headers custom del client. Indagare quale procedura ritorna Promise-valued fields non awaited.

---

## Dependencies

### Non duplicare librerie per lo stesso scopo

Se una libreria è già installata nel progetto (es. `pdfmake`), usarla — mai aggiungerne un'altra che fa la stessa cosa (es. `pdfkit`). Controllare sempre `package.json` prima di installare nuove dipendenze.

---

## Rate Limiting

### Nuova route rate-limited: aggiornare ENTRAMBE le mappe (drift = crash runtime)

Il rate limit vive in due mappe separate che devono restare in sync:

- `RATE_LIMIT_CONFIG` in `apps/api/src/lib/ratelimit.ts` — consumata da `withRateLimit(routeName)`.
- `DEFAULTS` in `apps/api/src/lib/rateLimitPolicy.ts` — consumata da `resolveRateLimitPolicy()` (cascata AppConfig → ENV → default).

`withRateLimit('foo')` chiama `resolveRateLimitPolicy('foo')`: se `foo` esiste solo in `RATE_LIMIT_CONFIG` ma NON in `DEFAULTS`, `DEFAULTS[routeName]` è `undefined` → `def.max` lancia `Cannot read properties of undefined (reading 'max')` a runtime (non a compile-time: il cast al call site nasconde il drift a TypeScript).

**Regola**: ogni nuova route rate-limited va aggiunta in TRE posti in sync:
1. `RATE_LIMIT_CONFIG` (`ratelimit.ts`)
2. `DEFAULTS` (`rateLimitPolicy.ts`) — **obbligatorio, altrimenti crash**
3. `RateLimitConfigSchema` (`packages/core/src/schemas/appConfig.ts`) — campo `.optional()`, altrimenti un override AppConfig/ENV viene silenziosamente ignorato dal resolver.

Regressione reale: `navSyncTrigger` mancante da `DEFAULTS` → sync fornitori NAV in crash in produzione (hotfix v1.9.1).
