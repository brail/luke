# @luke/nav

<!-- luke-docs:start:overview -->

One-way synchronization layer from Microsoft Dynamics NAV (SQL Server) into Luke's PostgreSQL database: the mssql connection pool, the sync of vendors (differential on a watermark), brands and seasons (full), and the `nav_pf_*` / `nav_kimo_*` analytics replicas the sales statistics read from. It never writes to NAV.

NAV table details and the decisions behind them: [`docs/nav-integration.md`](../../docs/nav-integration.md).

<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->

- `@luke/api` (`apps/api`) — the `integrations.nav.*` router (connection test, manual sync, sync filters), the `sales.*` router and its statistics services, and the three background schedulers (`navSyncScheduler`, `portafoglioSyncScheduler`, `kimoSyncScheduler`)

<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->

### Connection and configuration

| Symbol | Type | Description |
|--------|------|-------------|
| `getNavDbConfig(prisma, getConfig)` | function | Reads the `integrations.nav.*` keys from AppConfig — password decrypted, everything else plain — into a `NavDbConfig`; throws when a required key is missing |
| `sanitizeCompany(company)` | function | Validates the NAV company name and bracket-escapes it before it is interpolated into a `[COMPANY$Table]` identifier |
| `getPool(config)` / `closePool()` | function | Per-process mssql pool singleton: reconnects when the connection parameters change, and shares one in-flight connect between concurrent callers |
| `testNavConnection(config)` | function | Three-step diagnostic on a throwaway pool — SQL Server authentication, `SELECT 1`, existence of at least one `[COMPANY$…]` table — used by the NAV settings UI |
| `createSyncRequest(pool, timeoutMs?)` | function | An mssql request carrying an explicit timeout (default 60 s) instead of the driver default |

### Master-data sync

| Symbol | Type | Description |
|--------|------|-------------|
| `runNavSync(prisma, getConfig, logger?, entity?)` | function | Orchestrates vendors, brands and seasons — or the single entity requested — each in its own try/catch |
| `syncVendors` / `syncBrands` / `syncSeasons` | function | Per-entity sync: NAV read, `nav_*` replica upsert and local master upsert inside one transaction |

### Analytics replicas and reporting queries

| Symbol | Type | Description |
|--------|------|-------------|
| `syncPortafoglioNow(pool, company, prisma, logger)` | function | Refreshes the `nav_pf_*` order-portfolio replica: rowversion-incremental tables, active-season scoping on the sales documents, full refresh for the small lookups |
| `syncKimoNow(pool, company, prisma, logger)` | function | Refreshes the `nav_kimo_*` KIMO-FASHION replica with the same rowversion pattern and sync-state table |
| `queryPortafoglioOrdini(pool, company, params, logger?)` | function | Builds the complete order-portfolio dataset straight from NAV over mssql, for the on-demand Excel export |
| `queryPortafoglioFromPg(prisma, params)` | function | Same output shape, read from the local `nav_pf_*` replica |
| `queryKimoFromPg(prisma, params)` | function | Sales-order and basket union report, read from `nav_pf_*` and `nav_kimo_*` |

### Types

| Symbol | Type | Description |
|--------|------|-------------|
| `NavDbConfig` / `GetConfigFn` | type | Connection parameters, and the injected config-accessor signature that keeps this package free of any dependency on `apps/api` |
| `NavConnectionStep` | type | One diagnostic step of `testNavConnection`: name, outcome, message |
| `NavSyncReport` / `SyncResult` | type | Run summary (`startedAt`, `completedAt`, `results`) and the per-entity outcome (`entity`, `upserted`, `skipped`, `filterMode`) |
| `PortafoglioSyncResult` / `KimoSyncResult` | type | Replica sync outcome: per-table statistics, total duration, and the error message when the run failed |
| `TableSyncStats` | type | Rows upserted and elapsed time for a single replica table |
| `PortafoglioParams` / `PortafoglioRow` | type | Query filters — season and trademark mandatory, salesperson and customer optional — and the loosely typed result row |
| `KimoParams` / `KimoRow` | type | The same filters, and the typed row of the KIMO report |

<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->

- **Nothing is imported from `apps/api`.** Configuration arrives through `GetConfigFn`, and the Prisma client is passed in by the caller. `@luke/db` supplies Prisma types; `@luke/core` is not a dependency. The direction is enforced by two checks, not by convention: `tools/scripts/check-platform-integrity.ts` holds declared dependencies to the layer policy, and `@luke/no-undeclared-workspace-import` holds imports to what is declared.
- **Dual entity, and a soft delete the sync cannot undo.** Every synced entity has a `nav_*` replica faithful to NAV plus an enriched local master (`vendors`, `brands`, `seasons`). The sync writes only the fields that come from NAV — never `isActive`, never the enriched columns — so an entity deactivated by an administrator is never reactivated by a later run.
- **Table names are composed, never parameterized.** SQL Server cannot bind an identifier, so every table is built as `[${sanitizeCompany(config.company)}$TableName]` and `sanitizeCompany` rejects anything outside `[A-Za-z0-9 _\-.]` before escaping `]`. Raw SQL is confined to this package by `CLAUDE.md`; the one `$executeRawUnsafe` call, in `bulkUpsert`, takes its identifiers from the caller and always parameterizes values.
- **Two watermark strategies, for two kinds of table.** Vendor sync runs differentially on `[Last Date Modified]`, with an `OR [Last Date Modified] IS NULL` predicate because SQL Server drops NULLs from `>` comparisons — and whitelist mode deliberately ignores the watermark, so a vendor added to the list is picked up even if it was synced before. Brand and season always run a full sync because those NAV tables expose no modification date. The analytics replicas page on the SQL Server `rowversion` in chunks of 3 000 rows and persist their position in `nav_pf_sync_state`.
- **Batched writes, isolated failures.** Master upserts run in batches of 100 with the `nav_*` replica row and the local master row in a single `prisma.$transaction`; replica rows are bulk-upserted 500 at a time. Each entity has its own try/catch at every level, so one failing row or one failing entity never aborts the run — it is counted and logged.
- **Two read paths for the same statistics.** `queryPortafoglioOrdini` interrogates NAV directly over mssql for the full export, while `queryPortafoglioFromPg` and `queryKimoFromPg` read the local replicas and return the same shape. The dashboard therefore keeps working — on data as fresh as the last sync cycle — when NAV is unreachable.

<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->

```typescript
import type { PrismaClient } from '@luke/db';
import {
  closePool,
  getNavDbConfig,
  runNavSync,
  testNavConnection,
  type GetConfigFn,
  type NavSyncReport,
} from '@luke/nav';

/** Verifies the NAV connection, then syncs vendors only. */
export async function resyncVendors(
  prisma: PrismaClient,
  getConfig: GetConfigFn,
): Promise<NavSyncReport> {
  const config = await getNavDbConfig(prisma, getConfig);

  const { success, steps } = await testNavConnection(config);
  if (!success) {
    throw new Error(steps.filter(s => !s.ok).map(s => `${s.name}: ${s.message}`).join('; '));
  }

  // runNavSync resolves the configuration and the singleton pool itself.
  const report = await runNavSync(prisma, getConfig, undefined, 'vendor');
  await closePool();

  // report.results: [{ entity: 'vendor', upserted, skipped, filterMode }]
  return report;
}
```

<!-- luke-docs:end:example -->
