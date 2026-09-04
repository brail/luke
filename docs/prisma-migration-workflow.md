# Prisma Migration Workflow

Ogni modifica fisica al datamodel — model, enum, field, relation, mapping,
default, index o constraint, in uno qualunque dei file `packages/db/prisma/*.prisma`
— richiede una migration versionata. Una modifica limitata alla configurazione
`generator`/`datasource` in `schema.prisma` non la richiede, quando un
`prisma migrate diff` autorevole prova che non c'è differenza fisica di schema
(es. il cambio di generator del Cycle 11).
Lo schema è multi-file (uno `schema.prisma` con solo generator/datasource, più un
file per dominio — `identity.prisma`, `platform.prisma`, `catalog.prisma`, ecc.):
`prisma.config.ts` dichiara `schema: 'prisma'`, quindi il CLI legge l'intera
cartella `prisma/`, non il singolo file. Il workflow usa un Postgres temporaneo su
porta 5433 per generare la migration, poi la applica al DB dev (porta 5432) con
`db push`.

Schema, migration e `prisma.config.ts` vivono in `@luke/db`, quindi ogni comando
`prisma` va eseguito da `packages/db/`: è l'unica directory da cui il CLI risolve
tutti e tre. Restano invece in `@luke/api` il seed e gli script `db:*` di dominio
(bootstrap, reset NAV, backfill), che applicano regole applicative e importano
`apps/api/src/`.

## Workflow obbligatorio

```bash
pnpm --filter @luke/db db:migrate:new <nome_descrittivo>
git add packages/db/prisma/migrations packages/db/prisma/*.prisma
```

Lo script (`packages/db/scripts/new-migration.sh`) fa i quattro passi che prima erano da eseguire a
mano: avvia il Postgres usa-e-getta sulla 5433, attende che risponda, genera la migration contro
quello, lo ferma anche se qualcosa fallisce a metà, e allinea il DB di sviluppo con `db push`.
Il file prodotto in `prisma/migrations/` va committato insieme al/i file `.prisma` modificato/i.

**Perché un DB temporaneo e non quello di sviluppo**: il DB dev è allineato con `db push`, quindi
il suo `_prisma_migrations` non riflette lo storico versionato. `migrate dev` lo leggerebbe come
drift e proporrebbe di resettarlo, cancellando i dati.

### Note su Prisma 7 (valgono per qualunque comando `prisma` a mano)

- **`--skip-seed` non esiste più**, né su `migrate dev` né su `migrate reset`.
- **Il CLI non carica più `.env` da solo.** Un `npx prisma db push` nudo fallisce con
  `The datasource.url property is required in your Prisma config file` — messaggio fuorviante,
  perché `prisma.config.ts` la `datasource.url` ce l'ha: la legge da `process.env.DATABASE_URL`,
  che però non è popolata. Caricare l'env prima (`set -a && . ../../apps/api/.env && set +a`,
  come fanno gli script in `packages/db/package.json`) oppure passare `--url` esplicita.
  La `.env` è quella di `apps/api`: `DATABASE_URL` è bootstrap infrastrutturale del deployment
  (Env Policy in `CLAUDE.md`), non configurazione di `@luke/db` — c'è un solo database, quindi
  un solo posto dove è dichiarato.

## Produzione

- `entrypoint.sh` esegue `prisma migrate deploy` al boot del container
- Mai `prisma migrate reset` in produzione
- Baseline `20260318134249_init` versionata in git (`prisma/migrations/` non è in `.gitignore`)

## Troubleshooting: `migrate deploy` bloccato da drift con `db push`

`db push` non scrive su `_prisma_migrations`. Se in passato è stato lanciato
`migrate deploy` sullo stesso DB dev, può fallire a metà (es. `CREATE TYPE` già
esistente) lasciando una riga con `finished_at = NULL` che blocca ogni deploy
successivo.

**Diagnosi:**

```bash
docker exec luke-db-1 psql -U luke -d luke -c "SELECT migration_name FROM _prisma_migrations m1 WHERE finished_at IS NULL AND NOT EXISTS (SELECT 1 FROM _prisma_migrations m2 WHERE m2.migration_name = m1.migration_name AND m2.finished_at IS NOT NULL) ORDER BY migration_name;"
```

**Fix (solo dev, mai in prod):** verificare che lo schema live rispecchi già
l'effetto netto delle migration bloccate (confrontare con `\d` contro il contenuto
di `migration.sql`), poi `prisma migrate resolve --applied <nome>` per ciascuna in
ordine cronologico (serve `DATABASE_URL` esplicita: `set -a; source .env; set +a`).
Mai `resolve --applied` senza aver verificato che il DB rifletta davvero quello stato.
