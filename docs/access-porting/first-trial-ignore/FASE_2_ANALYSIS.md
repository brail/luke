# FASE 2 — Analisi Reverse Engineering

## ✅ Estrazione completata (Windows)

**File estratti in `queries/custom/q2/`:**

| Tipo | Quantità | Location | Status |
|------|----------|----------|--------|
| Query SQL | 1111 | `queries/` | ✅ Completo |
| Query metadata | 1111 | `queries.jsonl` | ✅ Completo |
| VBA modules | 34 | `vba_modules/` | ✅ Completo |
| VBA functions | N/A | `vba_functions.sql` | ✅ Completo |
| VBA index | N/A | `vba_index.json` | ✅ Completo |
| Combined SQL | N/A | `queries.sql` | ✅ Completo |

---

## 📊 Analisi Query

### Statistiche Generali

- **Query totali:** 1111
- **Query visibili:** 1106 (98.5%)
- **Query nascoste:** 0
- **Query di sistema:** 5 (prefix `~sq_`)
- **NAV-correlate:** 969 (87.2%)
- **Tabelle temporanee:** 53

### Distribuzione Complessità (SQL)

| Livello | Quantità | % | Esempi |
|---------|----------|---|--------|
| **Bassa** | 1011 | 91% | SELECT semplici, UNION basici |
| **Media** | 95 | 8.5% | JOIN multipli, subquery, CASE |
| **Alta** | 5 | 0.5% | PIVOT, CTE complesse, ricorsive |

### Query ad Alta Complessità (Target porting)

1. **qSoloVendNoFiltr-STEP0** — 10,948 chars
   - Contiene parametri, filtri dinamici
   - Probabilmente multi-step pipeline

2. **def01-ANALISIVENDUTO-PIVOT-step0** — 10,803 chars
   - Query PIVOT Access
   - Necessita conversione a T-SQL PIVOT/UNPIVOT

3. **qSoloVendItemConFiltroAgente** — 9,176 chars
4. **qSoloVendItem** — 9,143 chars
5. **qSoloVendItemConFiltroCliente** — 9,143 chars

---

## 🗄️ Tabelle NAV Referenziate

La query analysis ha identificato 969 query che referenziano NAV tables.

### Tabelle principali (inferite dai nomi query):

- **Sales** (Vendite)
  - Sales Header / Line
  - Sales Shipment Header / Line
  - Sales Invoice Header / Line
  - Sales Orders

- **Purchase** (Acquisti)
  - Purchase Header / Line
  - Purch. Receipt Header / Line
  - Purchase Invoice Header / Line

- **Items** (Articoli)
  - Item Master
  - Item Category
  - Item Unit of Measure
  - Item Variants

- **Customers & Vendors** (Parti)
  - Customer Master
  - Vendor Master
  - Customer Ledger Entries
  - Vendor Ledger Entries

- **Ledger & Posting**
  - G/L Entries
  - Customer Ledger Entries
  - Vendor Ledger Entries
  - Item Ledger Entries

---

## 🔗 Dipendenze Query

**509 query su 1111** (45.8%) hanno dipendenze da altre query.

### Pattern di dipendenza

**Multi-step pipelines (Comuni):**
```
Query-step0 (estrazione dati raw)
    ↓
Query-step1 (elaborazione)
    ↓
Query-step2 (aggregazione)
    ↓
Query/Report (presentazione)
```

**Esempio:**
- GraficoMiglioriArticoliVenduti-step1
  - ↓ DatiCarryOverESMU
  - ↓ GraficoMiglioriArticoliVenduti-step2
  - ↓ GraficoMiglioriArticoliVenduti (finale)

**UNION queries (15 query):**
- VenditeEPrenotazioniUnioneStatus
- CalcoloDisponibilita-step1
- ecc.

### Strategia porting

- Step 0: Raw data extraction → **Stored Procedures SQL Server**
- Step 1+: Transformation → **CTEs o Functions T-SQL**
- Step finale: **tRPC endpoint con export Excel**

---

## 💻 VBA Analysis

### Moduli estratti (34 file .bas/.cls)

**Standard modules:**
- Modulo1.bas — [Da analizzare]
- Modulo2.bas — [Da analizzare]
- ModuloBypass.bas — [Da analizzare]

**Form modules (13):**
- Form_Principale.cls — Form principale (UI)
- Form_Login.cls — Autenticazione Access (obsoleto in Luke)
- Form_CambiaPassword.cls — Change password (obsoleto in Luke)
- ecc.

**Report modules (20+):**
- Report_EtichettaImportatoDa.cls
- Report_Etichette*.cls — Label printing reports
- ecc.

### Funzionalità VBA da porting

**Priority HIGH (logica di business):**
- Calcoli reddittività
- Elaborazioni dati carry-over
- Validazioni dati
- Export Excel custom

**Priority LOW (UI/Access-specific):**
- Form navigation
- Login (sostituire con autenticazione Luke)
- Report generation (sostituire con tRPC export)

---

## 🎯 MVP — Porting Strategy

### Fase 1: Foundation (Settimana 1)

**Obiettivo:** Setup infrastruttura @luke/nav con 1-2 query di prova

1. **Creare `packages/nav/src/statistics/`**
   ```
   src/statistics/
   ├── queries/
   │   ├── venduto-step0.sql
   │   ├── venduto-step1.sql
   │   └── index.ts
   └── index.ts
   ```

2. **Porting QRY_001 (simplice):** `qSoloVend-step1`
   - Copia SQL → T-SQL
   - Sostituisci `[NEWERA$Sales Header]` con company-agnostic
   - Crea Stored Procedure in SQL Server

3. **tRPC endpoint di prova**
   ```typescript
   api.router({
     statistics: {
       venduto: async (input: {dateFrom, dateTo}) => {
         // Query NAV via @luke/nav
         // Return raw data
       }
     }
   })
   ```

### Fase 2: Core Queries (Settimane 2-3)

**Query MVP (copertura 80% use case):**

1. **qSoloVend-step0 & step1**
   - Vendite giornaliere
   - Filtri: cliente, agente, periodo

2. **def01-ANALISIVENDUTO-PIVOT-step0**
   - Analisi reddittività
   - Pivot table → JSON in tRPC

3. **CalcoloDisponibilita-step0/1**
   - Stock disponibile
   - Per singolo articolo o famiglia

4. **AnalisiCredito-step0**
   - Stato crediti clienti
   - Aged balance

5. **VenditeEPrenotazioni-CalcoloTotaleCoperto-step0**
   - Copertura ordini
   - Venduto + Prenotato

### Fase 3: Advanced (Settimane 4+)

- Cicli PIVOT complessi
- Dipendenze multi-step
- Export Excel template

---

## ⚠️ Problemi Attesi nel Porting

### Syntax Access → T-SQL

| Access Jet SQL | T-SQL SQL Server | Impatto |
|---|---|---|
| `#2023-01-01#` (date literals) | `'2023-01-01'` (YYYY-MM-DD) | ALTO — update all literals |
| `[NEWERA$Table]` (table prefix) | `[NEWERA$Table]` (OK) | Basso — OK in SQL Server |
| `IIf(condition, true, false)` | `CASE WHEN condition THEN true ELSE false END` | MEDIO — refactor 500+ IIf |
| `&` (string concat) | `+` (concat op) | BASSO — find/replace |
| `DISTINCT ROW` | `DISTINCT` | BASSO — semplifica |
| `DATE()` function | `CAST(GETDATE() as DATE)` | BASSO — sostituisci |
| `DATEDIFF(...)` | `DATEDIFF(unit, date1, date2)` | MEDIO — inversione parametri |
| `MOD()` | `%` operator | BASSO — replace `MOD(a,b)` → `a%b` |
| `Format(...)` | `FORMAT()` or formattazione app | ALTO — move to frontend |

### Stored Procedures vs Functions

- **Stored Procedures:** Modifiche dati (INSERT/UPDATE/DELETE)
- **Inline Table-Valued Functions (ITVFs):** Read-only, composabili
- **Strategy:** Usare ITVFs per query step-by-step, chainabili

### Company Prefix Dinamico

```sql
-- Access: hardcoded [NEWERA$Table]
-- SQL Server: parametrizzato

-- In @luke/nav:
DECLARE @Company VARCHAR(5) = 'NEWERA'
SELECT * FROM [NEWERA$Sales Header]

-- Diventa:
DECLARE @Company VARCHAR(5) = @CompanyPrefix  -- parametro
SELECT * FROM [NEWERA$Sales Header]  -- o CONCAT
```

---

## 📋 Checklist Porting per Query

Ogni query deve passare questi step:

- [ ] **Estrazione SQL Access** → `queries/custom/q2/queries/QRY_NNN.sql`
- [ ] **Conversione Jet → T-SQL**
  - [ ] Date literals
  - [ ] String functions
  - [ ] Math/aggregate functions
  - [ ] IIf → CASE WHEN
- [ ] **Parametrizzazione**
  - [ ] Filtri dinamici → @parametri
  - [ ] Company prefix → @CompanyPrefix
- [ ] **Testing**
  - [ ] Syntax check T-SQL
  - [ ] Esecuzione NAV test (se disponibile)
  - [ ] Confronto risultati Access vs SQL Server (campione)
- [ ] **Documentation**
  - [ ] Commenti header (source, purpose)
  - [ ] Parameter definitions
  - [ ] Dependencies documented
- [ ] **Integration in @luke/nav**
  - [ ] Aggiungi a `src/statistics/queries/index.ts`
  - [ ] Esporta funzione query
  - [ ] Type-safe return type (Zod)
- [ ] **tRPC endpoint**
  - [ ] Crea router endpoint
  - [ ] Input validation (date range, filters)
  - [ ] Output formatting (Excel export ready)

---

## 📈 Timeline Stimato

| Fase | Attività | Effort | Timeline |
|------|----------|--------|----------|
| Setup | Create @luke/nav structure, test queries | 1d | Giorno 1 |
| MVP | Port 5 core queries | 5d | Giorni 2-6 |
| Integration | tRPC endpoints, frontend dashboard | 3d | Giorni 7-9 |
| Testing | UAT, confronto Access | 2d | Giorni 10-11 |
| Advanced | Remaining queries (as needed) | 3d+ | TBD |

---

## 🔗 File Output

**Generati in questa fase:**

- ✅ `QUERIES_ANALYSIS.md` — Analisi completa 1111 query
- ✅ `raw/queries_statistics.json` — Statistiche JSON
- ✅ `queries/custom/q2/queries/` — 1111 file SQL originali
- ✅ `queries/custom/q2/vba_modules/` — 34 VBA modules

**Prossimi step (FASE 3):**

- [ ] Selezionare 5-10 query MVP per porting
- [ ] Convertire Jet SQL → T-SQL
- [ ] Creare Stored Procedures in SQL Server
- [ ] Aggiungere funzioni in `@luke/nav/src/statistics/`

---

## 📞 Prossimo Incontro

**FASE 3:** Porting delle query MVP

Hai preferenze su quale query portare per prima?

Suggerite (in ordine semplificat → complessità):
1. `qSoloVend-step1` (semplice SELECT con filtri)
2. `CalcoloDisponibilita-step0` (con JOIN, COUNT)
3. `def01-ANALISIVENDUTO-PIVOT-step0` (PIVOT Access → T-SQL PIVOT)

---

**Status:** ✅ **FASE 2 COMPLETATA**
