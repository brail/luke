
## `as any` vietato — usare `as Route` per redirect con typedRoutes

Con `typedRoutes: true` in `next.config.js`, `redirect()` richiede un tipo `Route`.
Per path validi a runtime ma non nel manifest statico (es. route group `(app)`), usare:

```typescript
import type { Route } from 'next';
redirect('/app/dashboard' as Route);
```

Mai `as any` — viola strict mode. Pattern già usato in `NotificationDropdown.tsx`.

## Soft-delete + slug uniqueness: usare partial index PostgreSQL

Quando un modello ha soft-delete (`isActive: Boolean`) e uno slug che deve restare unico tra i record attivi, la soluzione corretta è un **partial unique index PostgreSQL**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "company_functions_slug_active_key"
  ON "company_functions"("slug") WHERE "isActive" = true;
```

Prisma non supporta partial indexes nel DSL — va aggiunto a mano nella migration SQL.
Rimuovere `@unique` dallo slug in schema.prisma e aggiungere `@@index([slug])` per le query.

Nel router aggiungere guard esplicita in `create` (distingue slug-attivo vs slug-disattivato con messaggio chiaro) e procedure `restore` con anti-collision check.

**Alternativa DB-agnostica** (se mai si cambia DB): al soft-delete, nullare lo slug e salvarlo in `slugOriginal`. `NULL != NULL` in SQL → `@unique` funziona su tutti i DB. Per ora over-engineering: il progetto è locked su PostgreSQL.

## Non duplicare librerie per lo stesso scopo

Se una libreria è già installata nel progetto (es. `pdfmake`), usarla — mai aggiungerne un'altra che fa la stessa cosa (es. `pdfkit`). Controllare sempre `package.json` prima di installare nuove dipendenze.

## tRPC 11.18 + Fastify: UNSUPPORTED_MEDIA_TYPE / Unable to transform

**Problema**: upgrade tRPC 11.8→11.18 introduce protocollo streaming JSONL (`trpc-accept: application/jsonl`). Sia `httpBatchLink` che `httpBatchStreamLink` danno errori runtime.

**Root cause**: tRPC 11.18 aggiunge `isDataStream()` check — lancia `UNSUPPORTED_MEDIA_TYPE` se una procedura ritorna un oggetto con valori `Promise` o `AsyncIterable` in path non-streaming. Il Fastify custom content-type parser interferisce con `incomingMessageToRequest`.

**Fix**: usare `httpBatchStreamLink` (import da `@trpc/client`, non `@trpc/react-query`) + aggiungere `trpc-accept: application/jsonl` esplicito nelle headers custom del client. Indagare quale procedura ritorna Promise-valued fields non awaited.

## `prisma migrate deploy` su DB dev locale può bloccarsi per drift con `db push`

**Problema**: il workflow documentato per nuove migration usa `db push` (porta 5432) per applicare lo schema al DB dev — questo NON scrive su `_prisma_migrations`. Se in passato è mai stato lanciato `migrate deploy` sullo stesso DB, può fallire a metà (es. `CREATE TYPE` già esistente per oggetti creati da un push precedente) lasciando una riga con `finished_at = NULL` che blocca ogni deploy successivo, anche su migration successive scorrelate.

**Diagnosi**: `docker exec luke-db-1 psql -U luke -d luke -c "SELECT migration_name FROM _prisma_migrations m1 WHERE finished_at IS NULL AND NOT EXISTS (SELECT 1 FROM _prisma_migrations m2 WHERE m2.migration_name = m1.migration_name AND m2.finished_at IS NOT NULL) ORDER BY migration_name;"` — trova la/le migration bloccate senza retry riuscito.

**Fix (solo dev, mai in prod)**: verificare che lo schema live rispecchi già l'effetto netto delle migration bloccate (confrontare colonne/tabelle/tipi con `\d` contro il contenuto di `migration.sql`), poi `prisma migrate resolve --applied <nome>` per ciascuna in ordine cronologico (serve `DATABASE_URL` esplicita nell'env: `set -a; source .env; set +a`). Non eseguire mai `resolve --applied` senza aver prima verificato che il DB rifletta davvero quello stato.
