# Prisma Migration Workflow

Ogni modifica a `apps/api/prisma/schema.prisma` richiede una migration versionata.
Il workflow usa un Postgres temporaneo su porta 5433 per generare la migration,
poi la applica al DB dev (porta 5432) con `db push`.

## Workflow obbligatorio

```bash
pnpm --filter @luke/api db:migrate:new <nome_descrittivo>
git add apps/api/prisma/migrations apps/api/prisma/schema.prisma
```

Lo script (`apps/api/scripts/new-migration.sh`) fa i quattro passi che prima erano da eseguire a
mano: avvia il Postgres usa-e-getta sulla 5433, attende che risponda, genera la migration contro
quello, lo ferma anche se qualcosa fallisce a metà, e allinea il DB di sviluppo con `db push`.
Il file prodotto in `prisma/migrations/` va committato insieme a `schema.prisma`.

**Perché un DB temporaneo e non quello di sviluppo**: il DB dev è allineato con `db push`, quindi
il suo `_prisma_migrations` non riflette lo storico versionato. `migrate dev` lo leggerebbe come
drift e proporrebbe di resettarlo, cancellando i dati.

### Note su Prisma 7 (valgono per qualunque comando `prisma` a mano)

- **`--skip-seed` non esiste più**, né su `migrate dev` né su `migrate reset`.
- **Il CLI non carica più `.env` da solo.** Un `npx prisma db push` nudo fallisce con
  `The datasource.url property is required in your Prisma config file` — messaggio fuorviante,
  perché `prisma.config.ts` la `datasource.url` ce l'ha: la legge da `process.env.DATABASE_URL`,
  che però non è popolata. Caricare l'env prima (`set -a && . ./.env && set +a`, come fanno gli
  script `db:*` in `apps/api/package.json`) oppure passare `--url` esplicita.

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
