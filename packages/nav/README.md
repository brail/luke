# @luke/nav

<!-- luke-docs:start:overview -->

One-way synchronization layer from Microsoft Dynamics NAV (SQL Server) into Luke's PostgreSQL database: the mssql connection pool, the sync of vendors (differential on a watermark), brands and seasons (full), and the `nav_pf_*` / `nav_kimo_*` analytics replicas the sales statistics read from. It never writes to NAV.

NAV table details and the decisions behind them: [`docs/nav-integration.md`](../../docs/nav-integration.md).

<!-- luke-docs:end:overview -->

## Used By

<!-- luke-docs:start:dependents -->

- `@luke/api` (`apps/api`) — the `integrations.nav.*` router (connection test, manual sync, sync filters), the `sales.*` router and its statistics services, and the three background schedulers (`navSyncScheduler`, `portafoglioSyncScheduler`, `kimoSyncScheduler`)

<!-- luke-docs:end:dependents -->

## Main Exports

<!-- luke-docs:start:exports -->

### Connection and configuration

| Symbol | Type | Description |
|--------|------|-------------|
| `getNavDbConfig(prisma, getConfig)` | function | Reads the `integrations.nav.*` keys from AppConfig — password decrypted, everything else plain — into a `NavDbConfig`; throws when a required key is missing |
| `sanitizeCompany(company)` | function | Validates the NAV company name and bracket-escapes it before it is interpolated into a `[COMPANY$Table]` identifier |
| `getPool(config)` / `closePool()` | function | Per-process mssql pool singleton: reconnects when host, port, database, user or password change — a `readOnly` change alone keeps the existing pool — and shares one in-flight connect between concurrent callers |
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
| `queryPortafoglioOrdini(pool, company, params, logger?)` | function | Builds the order-portfolio dataset straight from NAV over mssql — the Excel export's fallback when the replica holds no row for the season and brand |
| `queryPortafoglioFromPg(prisma, params)` | function | Same output shape, read from the local `nav_pf_*` replica — the Excel export's first choice |
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

## Key Concepts

<!-- luke-docs:start:concepts -->

- **Nothing is imported from `apps/api`.** Configuration arrives through `GetConfigFn`, and the Prisma client is passed in by the caller. `@luke/db` supplies Prisma types; `@luke/core` is not a dependency. The direction is enforced by two checks, not by convention: `tools/scripts/check-platform-integrity.ts` holds declared dependencies to the layer policy, and `@luke/no-undeclared-workspace-import` holds imports to what is declared.
- **Dual entity, and a soft delete the sync cannot undo.** Every synced entity has a `nav_*` replica faithful to NAV plus an enriched local master (`vendors`, `brands`, `seasons`). The sync writes only the fields that come from NAV — never `isActive`, never the enriched columns — so an entity deactivated by an administrator is never reactivated by a later run.
- **Table names are composed, never parameterized.** SQL Server cannot bind an identifier, so every table is built as `[${sanitizeCompany(config.company)}$TableName]` and `sanitizeCompany` rejects anything outside `[A-Za-z0-9 _\-.]` before escaping `]`. `CLAUDE.md` places NAV SQL in this package, yet `apps/api` still queries NAV directly in two places, both through `createSyncRequest`: the salesperson fallback in `routers/sales.ts` and the live previews in `routers/integrations.nav.router.ts`. Raw PostgreSQL here takes three unsafe calls, all with bound values: `$executeRawUnsafe` in `bulkUpsert`, whose identifiers come from the caller, and `$queryRawUnsafe` in `queryPortafoglioFromPg` and `queryKimoFromPg`, whose values travel through `PgParams`.
- **Two watermark strategies, for two kinds of table.** Vendor sync runs differentially on `[Last Date Modified]`, with an `OR [Last Date Modified] IS NULL` predicate because SQL Server drops NULLs from `>` comparisons — and whitelist mode deliberately ignores the watermark, so a vendor added to the list is picked up even if it was synced before. Brand and season always run a full sync because those NAV tables expose no modification date. The analytics replicas page on the SQL Server `rowversion` in chunks of 3 000 rows and persist their position in `nav_pf_sync_state`.
- **Batched writes; failures isolated per row only in the master sync.** Master upserts run in batches of 100, each row with its `nav_*` replica row and local master row in one `prisma.$transaction` and its own try/catch, and each entity in its own try/catch in `runNavSync`: one failing row or entity is counted and logged, never fatal to the run. The analytics replicas are coarser. `bulkUpsert` writes 500 rows per statement, so one bad row fails its chunk and that table's run. KIMO has one try around header and lines, so a header failure skips the lines. The portfolio sync ends the cycle when the sales header fails; after it, the dependent and lookup tables run under `Promise.allSettled`, each failure logged on its own.
- **Two read paths for the portfolio.** The Excel export reads the local replica through `queryPortafoglioFromPg` and calls `queryPortafoglioOrdini` against NAV only when the replica holds no row for the season and brand (`apps/api/src/routers/sales.ts`). `queryKimoFromPg` reads the replicas too but returns its own `KimoRow` shape. Statistics therefore keep working — on data as fresh as the last sync cycle — while NAV is unreachable.

<!-- luke-docs:end:concepts -->

## Usage Example

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
