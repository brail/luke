# Integrazione Microsoft Dynamics NAV

## Panoramica

Luke sincronizza dati da **Microsoft Dynamics NAV** (SQL Server) verso il database locale PostgreSQL. La sincronizzazione è unidirezionale (NAV → Luke), differenziale e schedulata automaticamente.

Il codice risiede nel package dedicato `@luke/nav` (`packages/nav/`).

---

## Architettura

```
┌────────────────────────────────────────────────────────────────────────┐
│  Microsoft Dynamics NAV (SQL Server)                                   │
│  Tabelle: [Company$Vendor], ...                                        │
└───────────────────────────┬────────────────────────────────────────────┘
                            │  mssql (TCP)
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  packages/nav                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────────────────────┐│
│  │  client.ts      │  │  sync/                                       ││
│  │  ConnectionPool │  │  vendors.ts  — upsert differenziale NavVendor││
│  │  singleton      │  │  index.ts    — orchestrazione, filtri        ││
│  └─────────────────┘  └──────────────────────────────────────────────┘│
│  ┌─────────────────┐                                                  │
│  │  config.ts      │  — legge NavDbConfig da AppConfig (Prisma)       │
│  └─────────────────┘                                                  │
└───────────────────────────┬────────────────────────────────────────────┘
                            │  Prisma
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (DB locale)                                                │
│  nav_vendors           — replica locale dei fornitori NAV              │
│  nav_sync_filters      — configurazione filtro per entità              │
│  config                — AppConfig keys (connessione, schedule, flag)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Package `@luke/nav`

### `config.ts`

Legge la configurazione NAV dall'`AppConfig` (tabella `config` nel DB locale) e la restituisce come oggetto tipizzato `NavDbConfig`.

```ts
interface NavDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  company: string;     // prefisso tabelle NAV, es. "ACME"
  readOnly: boolean;   // ApplicationIntent=ReadOnly (SQL Server AG)
  syncEnabled: boolean;
}
```

> **Nota**: `readOnly` ottimizza la connessione per SQL Server Always On AG (replica di lettura). Non ha nulla a che fare con l'abilitazione del sync — per quello usare `syncEnabled`.

### `client.ts`

Singleton per il `ConnectionPool` di `mssql`. Gestisce:
- Lazy initialization al primo utilizzo
- Rilevamento di config cambiata (host, port, db, user, password) → pool invalidato e ricreato
- `connectingPromise` per evitare race condition su chiamate concorrenti
- `closePool()` per cleanup on shutdown

### `sync/vendors.ts`

Sincronizzazione differenziale della tabella `nav_vendors`:

1. Legge il watermark `MAX(navLastModified)` dalla tabella locale
2. Query su NAV: `[Company$Vendor]` con `WHERE [Last Date Modified] > @watermark OR [Last Date Modified] IS NULL`
3. Filtra i record in base al `NavSyncFilter` dell'entità
4. Upsert in batch da 100 record (`UPSERT_BATCH_SIZE`) via `prisma.navVendor.upsert`

### `sync/index.ts`

Orchestratore del sync:
- Controlla `syncEnabled` → se `false` restituisce `{ syncDisabled: true, results: [] }` senza toccare nulla
- Esegue in sequenza le entità registrate (attualmente: `vendor`)
- Restituisce `NavSyncReport` con tempi di esecuzione, contatori e modalità filtro

---

## AppConfig — chiavi NAV

Tutte le chiavi sono sotto il namespace `integrations.nav.*`:

| Chiave | Tipo | Default | Descrizione |
|--------|------|---------|-------------|
| `integrations.nav.host` | string | — | Hostname/IP del SQL Server |
| `integrations.nav.port` | number | — | Porta TCP (default NAV: 1433) |
| `integrations.nav.database` | string | — | Nome database NAV |
| `integrations.nav.user` | string | — | Utente SQL Server |
| `integrations.nav.password` | string (crypt) | — | Password SQL Server (cifrata in DB) |
| `integrations.nav.company` | string | — | Nome company NAV (prefisso tabelle) |
| `integrations.nav.readOnly` | boolean | false | `ApplicationIntent=ReadOnly` |
| `integrations.nav.syncEnabled` | boolean | false | Abilita sync automatico e manuale |
| `integrations.nav.syncIntervalMinutes` | number | 30 | Intervallo scheduler in minuti |

---

## Scheduler

Il file `apps/api/src/lib/navSyncScheduler.ts` registra due Fastify hooks:

- **`onReady`**: avvia uno `setInterval` con intervallo letto da AppConfig; esegue anche un primo sync immediato all'avvio
- **`onClose`**: cancella il timer e chiude il connection pool (`closePool()`)

Un flag `isRunning` impedisce esecuzioni sovrapposte (sync manuale + scheduler simultanei).

Se `integrations.nav.host` non è configurato, lo scheduler skippa silenziosamente senza loggare errori (comportamento atteso su fresh install).

---

## Database Models

### `NavVendor`

```prisma
model NavVendor {
  navNo      String   @id          // No_ da NAV
  name       String
  searchName String?               // Search Name da NAV (preferito in UI)
  navLastModified DateTime?        // Last Date Modified (watermark diff. sync)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  collectionRows CollectionLayoutRow[]

  @@map("nav_vendors")
}
```

### `NavSyncFilter`

```prisma
model NavSyncFilter {
  entity    String   @id           // es. "vendor"
  mode      String                 // "all" | "whitelist" | "exclude"
  navNos    String[]               // lista navNo selezionati/esclusi
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("nav_sync_filters")
}
```

### Relazione `CollectionLayoutRow` → `NavVendor`

Il campo `supplier` (testo libero) è stato rimosso e sostituito con una FK:

```prisma
navVendorId  String?
navVendor    NavVendor? @relation(fields: [navVendorId], references: [navNo], onDelete: SetNull)
```

Migration: `20260323220000_vendor_fk_on_collection_row`

---

## Filtri di sincronizzazione

Ogni entità supporta tre modalità di filtro, configurabili dalla UI in **Amministrazione › Sync NAV**:

| Modalità | Comportamento |
|----------|---------------|
| `all` | Tutti i record NAV vengono sincronizzati |
| `whitelist` | Solo i navNo nella lista `navNos` vengono sincronizzati |
| `exclude` | Tutti i record tranne quelli in `navNos` |

I filtri vengono applicati dopo aver recuperato i record da NAV, prima dell'upsert locale.

---

## Permissions / RBAC

| Permesso | Uso |
|----------|-----|
| `config:read` | Leggere la configurazione NAV, eseguire preview live |
| `config:update` | Salvare configurazione, salvare filtri, eseguire sync manuale |
| `collection_layout:update` | Leggere la lista vendor per il combobox nel Collection Layout |

Sezioni RBAC:

| Sezione | Gruppo | Default admin | Default editor/viewer |
|---------|--------|---------------|-----------------------|
| `admin.brands` | Amministrazione | ✓ | ✗ |
| `admin.seasons` | Amministrazione | ✓ | ✗ |
| `admin.nav_sync` | Amministrazione | ✓ | ✗ |
| `settings.nav` | Impostazioni | ✓ | ✗ |

---

## UI

### Impostazioni › Microsoft NAV (`/settings/nav`)

Configurazione della connessione SQL Server: host, porta, database, utente, password, company, flag `readOnly` e `syncEnabled`.

### Amministrazione › Sync NAV (`/admin/nav-sync`)

- **Filtro di sincronizzazione**: selezione modalità (all/whitelist/exclude) e whitelist/blacklist interattiva
- **Esegui sync**: avvia sync manuale on-demand con feedback su record sincronizzati e durata
- **Anteprima fornitori**: query live su NAV SQL Server con ricerca testuale e checkbox per gestire la selezione

### Collection Layout — Combobox fornitore

Nel drawer di creazione/modifica riga, il campo "Fornitore" è un combobox che carica i vendor sincronizzati localmente (`trpc.integrations.nav.vendors.list`). Visualizza `searchName ?? name`, con opzione "— Nessuno —" per deselezionare. Il valore salvato è `navVendorId` (FK → `nav_vendors.navNo`).

---

## Avvio in sviluppo

Per testare senza un NAV reale:
- Lasciare `syncEnabled = false` in AppConfig
- La tendina fornitore mostrerà solo i vendor già presenti in `nav_vendors` (popolabili via seed o import manuale)

Per testare con NAV reale:
1. Configurare la connessione in **Impostazioni › Microsoft NAV**
2. Verificare la connettività TCP con il bottone "Testa connessione"
3. Abilitare `syncEnabled` e salvare
4. Eseguire un sync manuale da **Amministrazione › Sync NAV**
