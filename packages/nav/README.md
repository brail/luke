# @luke/nav

<!-- luke-docs:start:overview -->
Sync layer unidirezionale da Microsoft Dynamics NAV (SQL Server) verso il database PostgreSQL di Luke. Gestisce la replica differenziale di vendor, brand, stagioni e dati portafoglio ordini senza mai scrivere su NAV.
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- `@luke/api` (`apps/api`) — router tRPC `integrations.nav.*`, endpoint sync manuale e job di sync periodico
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `getNavDbConfig` | funzione | Costruisce la configurazione connessione SQL Server da `GetConfigFn` |
| `sanitizeCompany` | funzione | Sanitizza il nome azienda per i table name `[COMPANY$Table]` |
| `getPool` / `closePool` | funzione | Gestisce il pool di connessioni MSSQL (singleton) |
| `testNavConnection` | funzione | Verifica la connessione NAV step-by-step (usata nel test connessione UI) |
| `runNavSync` | funzione | Esegue il ciclo di sync completo (vendors + brands + seasons) |
| `syncVendors` | funzione | Sync differenziale vendor (watermark-based) |
| `syncBrands` | funzione | Sync completo brand da NAV |
| `syncSeasons` | funzione | Sync completo stagioni da NAV |
| `queryPortafoglioOrdini` | funzione | Query replica NAV per statistiche portafoglio ordini |
| `NavSyncReport` | tipo | Report esito sync: entità processate, errori, timestamp |
| `SyncResult` | tipo | Esito di un singolo ciclo sync per un'entità |
| `NavDbConfig` | tipo | Configurazione connessione SQL Server |
| `GetConfigFn` | tipo | Firma della funzione di iniezione config (evita accoppiamento circolare con `apps/api`) |
| `NavConnectionStep` | tipo | Step del test connessione con esito e messaggio |
| `PortafoglioParams` / `PortafoglioRow` | tipo | Parametri e riga risultato query portafoglio ordini |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **Nessun import da `apps/api`**: la configurazione è iniettata tramite `GetConfigFn` — dependency injection per evitare accoppiamento circolare tra package e app.
- **Entità duale**: ogni entità NAV ha una tabella replica `nav_*` (fedele a NAV) e una tabella locale arricchita (`vendors`, `brands`, `seasons`). Il sync aggiorna solo i campi provenienti da NAV — mai `isActive` né campi locali arricchiti.
- **Soft delete protetto**: il sync non riattiva mai entità con `isActive=false`. La disattivazione è un'azione manuale dell'amministratore; NAV non ne è a conoscenza.
- **Table name parametrico**: i nomi delle tabelle SQL Server seguono il pattern `[${sanitizeCompany(config.company)}$TableName]` — mai hardcodati, mai parametrizzabili via SQL injection.
- **Batch + transaction**: ogni upsert usa `processInBatches` (batch 100) e wrappa replica NAV + upsert locale in `prisma.$transaction()`. Un errore su una singola entità non blocca le altre.
- **`queryPortafoglioOrdini`** legge esclusivamente dalla replica `nav_pf_*` in PostgreSQL — non effettua mai query dirette al DB NAV in produzione per le statistiche.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->
```typescript
import { testNavConnection, runNavSync } from '@luke/nav';

// Test connessione step-by-step (UI settings NAV)
const steps = await testNavConnection(getConfigFn);
// steps: [{ step: 'resolve_config', ok: true }, { step: 'connect', ok: true }, ...]

// Ciclo sync completo
const report = await runNavSync({ getConfig: getConfigFn, prisma });
// report.vendors.created / report.brands.updated / report.seasons.skipped
```
<!-- luke-docs:end:example -->
