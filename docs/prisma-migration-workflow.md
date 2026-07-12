# Prisma Migration Workflow

Ogni modifica a `apps/api/prisma/schema.prisma` richiede una migration versionata.
Il workflow usa un Postgres temporaneo su porta 5433 per generare la migration,
poi la applica al DB dev (porta 5432) con `db push`.

## Workflow obbligatorio

```bash
# 1. Postgres temporaneo su porta 5433
docker run --rm -d --name luke-pg-migrate -p 5433:5432 \
  -e POSTGRES_DB=luke -e POSTGRES_USER=luke -e POSTGRES_PASSWORD=luke \
  postgres:16-alpine
sleep 4 && docker exec luke-pg-migrate pg_isready -U luke -d luke

# 2. Genera migration
cd apps/api
DATABASE_URL="postgresql://luke:luke@localhost:5433/luke" \
  pnpm exec prisma migrate dev --name <nome_descrittivo> --skip-seed

# 3. Stop container
docker stop luke-pg-migrate

# 4. Applica al DB dev (porta 5432)
cd apps/api && npx prisma db push

# 5. Committa il file migration insieme alle modifiche allo schema
```

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
