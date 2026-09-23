# Microsoft Dynamics NAV integration

## Overview

Luke synchronizes data from **Microsoft Dynamics NAV** (SQL Server) into the
local PostgreSQL database. Synchronization is one-way (NAV → Luke). Vendors are
synchronized differentially; brands and seasons are read in full on every run.
Each entity runs on a schedule only once automatic sync has been enabled for it
(see Scheduler).

The code lives in the dedicated `@luke/nav` package (`packages/nav/`).

The same package also maintains the `nav_pf_*` (order portfolio) and
`nav_kimo_*` (KIMO-FASHION) analytics replicas, driven by
`portafoglioSyncScheduler.ts` and `kimoSyncScheduler.ts` in `apps/api/src/lib/`.
This document does not cover them.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Microsoft Dynamics NAV (SQL Server)                                   │
│  Tables: [Company$Vendor], ...                                         │
└───────────────────────────┬────────────────────────────────────────────┘
                            │  mssql (TCP)
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  packages/nav                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  client.ts      │  │  sync/                                       │ │
│  │  ConnectionPool │  │  vendors.ts  — differential upsert           │ │
│  │  singleton      │  │                NavVendor + Vendor            │ │
│  └─────────────────┘  │  brands.ts   — full upsert NavBrand + Brand  │ │
│                       │  seasons.ts  — full upsert NavSeason +       │ │
│                       │                Season                        │ │
│                       │  index.ts    — orchestration                 │ │
│                       │  utils.ts    — filters, batching, timeout    │ │
│                       └──────────────────────────────────────────────┘ │
│  ┌─────────────────┐                                                   │
│  │  config.ts      │  — reads NavDbConfig from AppConfig (Prisma)      │
│  └─────────────────┘                                                   │
└───────────────────────────┬────────────────────────────────────────────┘
                            │  Prisma
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (local DB)                                                 │
│  nav_vendors           — local replica of NAV vendors                  │
│  nav_brands            — local replica of NAV brands                   │
│  nav_seasons           — local replica of NAV seasons                  │
│  vendors, brands,      — local master records, optionally NAV-linked   │
│    seasons                                                             │
│  nav_sync_filters      — filter and schedule configuration per entity  │
│  app_configs           — AppConfig keys (connection, global sync flag) │
└────────────────────────────────────────────────────────────────────────┘
```

---

## The `@luke/nav` package

### `config.ts`

Reads the NAV configuration from `AppConfig` (the `app_configs` table in the
local DB) and returns it as a typed `NavDbConfig` object.

```ts
interface NavDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  company: string;     // NAV table prefix, e.g. "ACME"
  readOnly: boolean;   // ApplicationIntent=ReadOnly (SQL Server AG)
}
```

> **Note**: `readOnly` tunes the connection for a SQL Server Always On
> availability group (read replica). It has nothing to do with enabling sync —
> that is `integrations.nav.syncEnabled`, which is not part of `NavDbConfig`
> and is read by the scheduler directly.

### `client.ts`

Singleton for the `mssql` `ConnectionPool`. It handles:
- Lazy initialization on first use
- Detection of a changed config (host, port, database, user, password) → the
  pool is invalidated and recreated
- `connectingPromise`, to avoid race conditions between concurrent calls
- `closePool()`, for cleanup on shutdown

### `sync/vendors.ts`

Differential sync of the `nav_vendors` table:

1. Reads the watermark `MAX(navLastModified)` from the local table. There is no
   watermark on the first run (empty table), nor in `whitelist` mode, which
   always re-reads every selected vendor
2. Queries NAV: `[Company$Vendor]` with
   `WHERE [Last Date Modified] > @lastModified OR [Last Date Modified] IS NULL`
3. Applies the entity's `NavSyncFilter` inside that same query, as an `IN` /
   `NOT IN` predicate on `[No_]`
4. Upserts in batches of 100 records (`UPSERT_BATCH_SIZE`); each record upserts
   `nav_vendors` and the linked local `Vendor` (name and country code only,
   never `isActive`) in a single `prisma.$transaction`

### `sync/index.ts`

Sync orchestrator (`runNavSync`):
- Does not read `syncEnabled`: that switch is checked only by the scheduler, so
  a manual run is not subject to it
- Runs the registered entities in sequence — `vendor`, `brand`, `season` — or
  only the one requested. Brands and seasons are always read in full, because
  their NAV tables expose no modification date
- Returns a `NavSyncReport` with execution times, counters and the filter mode

---

## AppConfig — NAV keys

All keys live under the `integrations.nav.*` namespace:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `integrations.nav.host` | string | — | SQL Server hostname/IP |
| `integrations.nav.port` | number | — | TCP port (NAV default: 1433) |
| `integrations.nav.database` | string | — | NAV database name |
| `integrations.nav.user` | string | — | SQL Server user |
| `integrations.nav.password` | string (encrypted) | — | SQL Server password (encrypted in the DB) |
| `integrations.nav.company` | string | — | NAV company name (table prefix) |
| `integrations.nav.readOnly` | boolean | true | `ApplicationIntent=ReadOnly` |
| `integrations.nav.syncEnabled` | boolean | false | Global switch for the scheduled vendor/brand/season sync; does not gate the manual sync |

The two defaults are the values `apps/api/prisma/seed.ts` writes; none of these
keys has an entry in `APP_CONFIG_DEFAULTS`. With its row absent, `readOnly`
reads as `true`, and the scheduler treats `syncEnabled` as enabled: it stops
only on an explicit `false`. There is no interval key: the sync interval is
stored per entity in `NavSyncFilter` (see Scheduler).

---

## Scheduler

The file `apps/api/src/lib/navSyncScheduler.ts` registers two Fastify hooks:

- **`onReady`**: starts a fixed 60-second `setInterval` tick, and runs the
  first tick immediately. On each tick, for each entity (`vendor`, `brand`,
  `season`), it reads the entity's `NavSyncFilter` row and starts a sync only
  if `autoSyncEnabled` is true (default `false`) and at least `intervalMinutes`
  (default 30) have passed since that entity's last run. An entity without a
  filter row is never scheduled
- **`onClose`**: clears the timer and closes the connection pool
  (`closePool()`)

A per-entity `isRunning` flag prevents overlapping scheduled runs of the same
entity within one process, and a `SchedulerLock` row (`nav-sync:<entity>`) does
the same across API instances. Neither guards the manual sync
(`integrations.nav.sync.run`), which calls `runNavSync` directly and can
therefore overlap a scheduled run.

If `integrations.nav.host` is not configured, the scheduler skips the tick
silently, without logging errors (expected behavior on a fresh install). It
also skips the tick when `integrations.nav.syncEnabled` is `false`.

---

## Database models

All four NAV sync models live in `packages/db/prisma/catalog.prisma`.
`NavBrand` (`nav_brands`) and `NavSeason` (`nav_seasons`) replicate the NAV
brand and season tables, keyed by the NAV `Code`; local `Brand.navBrandId` and
`Season.navSeasonId` link to them (`onDelete: SetNull`).

### `NavVendor`

```prisma
model NavVendor {
  navNo      String  @id // No_ from NAV
  name       String  // Name
  name2      String? // Name 2
  searchName String? // Search Name
  firstName  String? // First Name
  lastName   String? // Last Name

  address     String? // Address
  address2    String? // Address 2
  postCode    String? // Post Code
  city        String? // City
  county      String? // County
  countryCode String? // Country_Region Code

  phoneNo  String? // Phone No_
  faxNo    String? // Fax No_
  email    String? // E-Mail
  homePage String? // Home Page
  contact  String? // Contact

  vendorType String? // Vendor Type

  navLastModified DateTime? // Last Date Modified (differential sync watermark)
  syncedAt        DateTime  // timestamp of the last sync

  vendor Vendor? // linked local vendor record

  @@index([name])
  @@index([syncedAt])
  @@index([navLastModified])
  @@map("nav_vendors")
}
```

### `NavSyncFilter`

```prisma
model NavSyncFilter {
  id              String    @id @default(cuid())
  entity          String    // e.g. "vendor"
  mode            String    // "all" | "whitelist" | "exclude"
  navNos          String[]  // list of selected/excluded NAV codes
  active          Boolean   @default(true)
  note            String?
  autoSyncEnabled Boolean   @default(false) // scheduler syncs this entity
  intervalMinutes Int       @default(30)    // automatic sync interval
  updatedAt       DateTime  @updatedAt
  lastSyncStatus  String?   // "SUCCESS" | "FAILURE" of the last scheduled run
  lastSyncError   String?
  lastSyncAt      DateTime?

  @@unique([entity])
  @@index([entity, active])
  @@map("nav_sync_filters")
}
```

### `CollectionLayoutRow` → `Vendor` → `NavVendor` relation

The `supplier` field (free text) was removed and first replaced with a direct
FK to `NavVendor` (migration `20260323220000_vendor_fk_on_collection_row`). The
next migration moved the row onto the local vendor registry and dropped that
column, so a collection row now reaches NAV through `Vendor`:

```prisma
// CollectionLayoutRow (collection.prisma)
vendorId    String?
vendor      Vendor? @relation(fields: [vendorId], references: [id], onDelete: SetNull)

// Vendor (catalog.prisma)
navVendorId String?    @unique
navVendor   NavVendor? @relation(fields: [navVendorId], references: [navNo], onDelete: SetNull)
```

Migration: `20260324100000_add_vendors_table`

---

## Sync filters

Each entity supports three filter modes, configurable from the UI in
**Impostazioni › Sincronizzazione NAV**:

| Mode | Behavior |
|------|----------|
| `all` | All NAV records are synchronized |
| `whitelist` | Only the codes in the `navNos` list are synchronized |
| `exclude` | All records except those in `navNos` |

The codes are the NAV `No_` for vendors and `Code` for brands and seasons.

Filters are applied inside the NAV query, as an `IN` / `NOT IN` predicate, not
after the records have been fetched. An entity with no filter row, with
`active = false`, or with an empty whitelist is skipped entirely.

---

## Permissions / RBAC

| Permission | Use |
|------------|-----|
| `config:read` | Read the NAV configuration, run the live preview |
| `config:update` | Save the configuration, save filters and the sync schedule, run a manual sync |
| `vendors:read` | Read the vendor list for the combobox in Collection Layout |

RBAC sections:

| Section | Group | Default admin | Default editor/viewer |
|---------|-------|---------------|-----------------------|
| `admin.brands` | Amministrazione | ✓ | ✗ |
| `admin.seasons` | Amministrazione | ✓ | ✗ |
| `settings.nav_sync` | Impostazioni | ✓ | ✗ |
| `settings.nav` | Impostazioni | ✓ | ✗ |

---

## UI

### Impostazioni › Microsoft NAV (`/settings/nav`)

SQL Server connection configuration: host, port, database, user, password,
company, and the `readOnly` and `syncEnabled` flags.

### Impostazioni › Sincronizzazione NAV (`/settings/nav-sync`)

One tab per entity (`Fornitori`, `Brand`, `Stagioni`), each with:

- **Sync criterion** ("Criterio di sincronizzazione"): mode selection
  (all/whitelist/exclude), interactive whitelist/blacklist, and the automatic
  sync schedule (on/off and interval)
- **Run sync** ("Esegui sync"): starts an on-demand manual sync, with feedback
  on records synchronized and duration; disabled until a criterion has been
  saved
- **NAV preview**: live query against the NAV SQL Server, with text search and
  checkboxes to manage the selection; shown only in whitelist/exclude mode

The page also has `Portafoglio Vendite` and `KIMO-FASHION` tabs for the
analytics replicas, which this document does not cover.

### Collection Layout — vendor combobox

In the row create/edit drawer, the "Fornitore" field is a combobox that loads
the active vendors of the local vendor registry (`trpc.vendors.list`), not the
NAV replica. It displays `nickname ?? name`, with a "— Nessuno —" option to
clear the selection. The saved value is `vendorId` (FK → `vendors.id`).

---

## Running in development

To test without a real NAV:
- Leave `syncEnabled = false` in AppConfig
- The vendor dropdown shows only the vendors already in the local registry
  (`vendors`); no seed populates it, so create them by hand in
  **Amministrazione › Fornitori**

To test with a real NAV:
1. Configure and save the connection in **Impostazioni › Microsoft NAV**
2. Check the connection with the "Test Connessione" button: it verifies SQL
   Server authentication, database access and that at least one
   `[Company$...]` table exists
3. Enable `syncEnabled` and save (needed only for scheduled runs)
4. In **Impostazioni › Sincronizzazione NAV**, save a sync criterion for the
   entity, then run a manual sync
