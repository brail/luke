# VBA Analysis — NewEraStat.accdb

## 📋 Panoramica

Il file Access è un'**applicazione di reporting statistiche su dati NAV** con UI per filtri e export Excel.

**Tipo:** Reporting dashboard con export
**Dimensione:** 34 VBA modules (291 KB Form_Principale.cls, 29 KB Modulo1.bas)
**Scopo:** Analisi vendite, acquisti, disponibilità, crediti clienti

---

## 🎯 Core Flow Identificato

### Main Entry: Form_Principale.cls

**Form principale (UI):**
- Filtri multi-selezione (stagioni, marchi, clienti, agenti)
- Data picker (periodo analisi)
- Bottoni di export Excel

**Funzionalità VBA:**
- Dinamicamente modifica query SQL in memoria
- Costruisce WHERE clause da filtri UI (string concatenation)
- Lancia export Excel tramite query results

---

## 📊 Excel Export Principal: "NewEra-AnalisiVendite"

### Query Pipeline

```
qSoloVend-step0 (raw sales data)
    ↓ [JOIN con Customer, Item, Vendor, etc.]
qSoloVend-step1 (enriched sales data, grouped)
    ↓ [JOIN con DatiCarryOverESMU, MustBuy, etc.]
def01-ANALISIVENDUTO-PIVOT-step0 (enriched + calcolati)
    ↓ [Aggiunge lookup customer, item, geographical zones]
def01-ANALISIVENDUTO-PIVOT (final report)
    ↓
Excel export
```

### Query Principale: `def01-ANALISIVENDUTO-PIVOT-step0`

**Dimensione:** ~10,000+ chars, ultra-complessa
**JOIN:** 12+ LEFT JOINs da tabelle ausiliarie
**Campi:** 200+ campi selezionati
**Calcoli:** Margini, provvigioni, sconto, valutazioni

**Semantica:**
1. Estrae da `qSoloVend-step1` (base vendite)
2. JOINs con:
   - Item → descrizione, categoria, tipologia
   - Customer → anagrafica, zona, rischio credito
   - Variable Code → colore (lookup)
   - Geographical Zone (3 joins diverse) → descrizioni zone
   - LandedCost → costo importazione
   - DatiCarryOverESMU → carry over da stagioni precedenti
   - MustBuy-ArticoloColore → flag must-buy per colore
   - Vendor (2 joins diverse) → fornitore, manifatturiero

3. Calcoli derivati:
   - `[quantityshipped]+[quantityreadyforshippingrilasciate] AS QuantityShippedReleased`
   - `[pairsshipped]+[pairsreadyforshippingrilasciate] AS PairsShippedReleased`
   - `[valueshipped]+[valuereadyforshippingrilasciate] AS ValueShippedReleased`
   - `[pairsSold]*([landed cost]) AS EstimatedLandedCostOnSold`
   - `[ValueSold]-[pairsSold]*([landed cost]) AS EstimatedMargin`
   - Commissioni (4 soggetti): `[valuesold]*[provvigioneagente]/100`
   - Margine secondo: `[EstimatedMargin]-[commissioni 1..4] AS EstimatedSecondMargin`

---

## 🔍 Analisi SQL Query

### qSoloVend-step0 (base)

```sql
SELECT [Sales Line].*, Customer.*, Item.*
FROM [Sales Line]
INNER JOIN Customer ON ...
LEFT JOIN ...
```

**Uso:** Raw sales line data con base customer/item lookup

### qSoloVend-step1

```sql
SELECT qSoloVend-step0.*
FROM qSoloVendItem INNER JOIN Customer...
GROUP BY (tutto)
```

**Uso:** Aggregazione per document line (sum quantities, value)

---

## ⚠️ Problemi Identificati

### 1. **Ultra-Long Query con 200+ Campi**
- def01-ANALISIVENDUTO-PIVOT-step0: ~15,000 chars
- 12+ LEFT JOINs
- Difficile da leggere, mantenere, ottimizzare

**Problema:** Probabilmente performance issue su dataset grande

**Soluzione:**
```
Dividi in 3 steps:
1. Base sales + item/customer lookup (necessary fields only)
2. Carry-over, must-buy, geographical zones
3. Margin calculations (derivate in memoria o Excel)
```

### 2. **Calcoli Margine & Commissioni in SQL**
```sql
[EstimatedMargin] = [ValueSold]-[pairsSold]*([landed cost])
[EstimatedCommissionSalesPerson] = [valuesold]*[provvigioneagente]/100
...
```

**Problema:**
- Dipendenza da lookup LandedCost (potrebbe essere NULL)
- Multipli calcoli di commissioni (4 soggetti)
- Potrebbe farlo Excel/backend piú velocemente

**Soluzione:**
```
Sposta calcoli a:
- Backend TypeScript (Decimal preciso)
- Excel template (SUM formulas)
NO in SQL (troppi edge cases)
```

### 3. **Multiple Geographical Zone Joins (3 volte)**
```sql
LEFT JOIN [Geographical Zone] ON [qSoloVend-step1].[Geographical Zone] = [Geographical Zone].Code
LEFT JOIN [Geographical Zone] AS [Geographical Zone_1] ON [qSoloVend-step1].[Geographical Zone 2] = [Geographical Zone_1].Code
LEFT JOIN [Geographical Zone] AS [Geographical Zone_2] ON [qSoloVend-step1].ShipToGeographicalZone2 = [Geographical Zone_2].Code
```

**Problema:**
- Same table, 3 diverse join conditions
- Ridondante (la stessa zona potrebbe comparire 3 volte)

**Soluzione:**
```
UNION 3 queries separate:
1. Zone di vendita
2. Zone di spedizione base
3. Zone di spedizione ship-to

Oppure: normalizza a 1 zona sola in qSoloVend-step1
```

### 4. **Dipendenza da DatiCarryOverESMU**
```sql
INNER JOIN DatiCarryOverESMU ON ...
```

**Problema:** Tabella temporanea che deve essere pre-calcolata

**Domanda:** Chi crea questa tabella? VBA? Report?

**Soluzione:** Renderla una VIEW in SQL Server, non tabella temp

### 5. **Molti IIf() in SELECT per lookups**
```sql
IIf([Store Distribution]=3,"3-Dept.Store",
    IIf([Store Distribution]=2,"2-Indipendent",
        IIf([Store Distribution]=1,"1-Chain","0-UNK")))
AS StoreDistribution
```

**Problema:** Access logic, dovrebbe essere in lookup table

**Soluzione:**
```sql
CASE
  WHEN [Store Distribution]=3 THEN '3-Dept.Store'
  WHEN [Store Distribution]=2 THEN '2-Independent'
  WHEN [Store Distribution]=1 THEN '1-Chain'
  ELSE '0-UNK'
END AS StoreDistribution
```

---

## 🎯 Ottimizzazioni Proposte

### Priority 1: Query Splitting (Impatto ALTO)

**Prima:**
```
def01-ANALISIVENDUTO-PIVOT-step0 (1 query gigante, 15k chars, 12 JOINs)
                ↓
            Excel
```

**Dopo:**
```
Step 1: Sales_Base (qSoloVend-step1 + Customer + Item essenziali)
        ↓
Step 2: Sales_Enriched (+ Carry-over, MustBuy, Zones lookups)
        ↓
Step 3: Sales_Final (+ Margin calculations)
        ↓
    Excel
```

**Benefici:**
- ✅ Leggibilità x10
- ✅ Manutenibilità
- ✅ Testabilità per step
- ✅ Cachability (cache step1, step2)
- ✅ Possibile parallelizzazione

### Priority 2: Spostare Calcoli Fuori SQL (Impatto MEDIO)

**Prima:**
```sql
SELECT
  ...100 campi,
  [pairsSold]*([landed cost]) AS EstimatedLandedCostOnSold,
  [ValueSold]-[pairsSold]*([landed cost]) AS EstimatedMargin,
  [valuesold]*[provvigioneagente]/100 AS EstimatedCommissionSalesPerson,
  ...
```

**Dopo (SQL):**
```sql
SELECT
  [qSoloVend-step1].*,
  DatiCarryOverESMU.*,
  LandedCost.[landed Cost]
FROM ...
```

**Dopo (Backend TypeScript):**
```typescript
export async function calculateMargins(rows: SalesRow[]) {
  return rows.map(row => ({
    ...row,
    estimatedLandedCost: row.pairsSold * row.landedCost,
    estimatedMargin: row.valueSold - (row.pairsSold * row.landedCost),
    commissions: {
      salesPerson: (row.valueSold * row.provvigioneAgente) / 100,
      areaManager: (row.valueSold * row.provvigioneCapozona) / 100,
      subject1: (row.valueSold * row.provvigioneSoggetto1) / 100,
      subject2: (row.valueSold * row.provvigioneSoggetto2) / 100,
    },
    secondMargin: /* calculated */
  }))
}
```

**Benefici:**
- ✅ Errori numerici diminuiti (TypeScript Decimal)
- ✅ SQL piú leggibile
- ✅ Riusabile in API
- ✅ Testabile
- ✅ Cacheable

### Priority 3: Normalizzare Geografiche (Impatto BASSO)

**Consolidare 3 zone in 1 select semplice:**
```sql
SELECT
  ...
  SalesZone.Description AS SalesZoneDescription,
  ShipZone.Description AS ShipZoneDescription
FROM [qSoloVend-step1]
LEFT JOIN [Geographical Zone] AS SalesZone ON [qSoloVend-step1].[Geographical Zone] = SalesZone.Code
LEFT JOIN [Geographical Zone] AS ShipZone ON [qSoloVend-step1].ShipToGeographicalZone2 = ShipZone.Code
```

**Benefici:**
- ✅ -2 JOINs inutili
- ✅ Leggibilità

---

## 📊 VBA Modules Summary

| Modulo | Size | Purpose |
|--------|------|---------|
| **Form_Principale.cls** | 291 KB | Main UI, filters, export |
| **Modulo1.bas** | 29 KB | Utility functions, export logic |
| **Modulo2.bas** | 3.6 KB | [Da analizzare] |
| **ModuloBypass.bas** | 1.7 KB | [Da analizzare] |
| Reports (20+) | N/A | Label/etichette printing |
| Forms (3+) | N/A | Login, password change |

### Form_Principale Functions (Estratto)

```vba
Sub sistemaquerysolostagionaleepronto()
  ' Scambia query SQL in memoria:
  ' If FilterValue = True:
  '   qdf1.SQL = "...only seasonal orders..."
  ' Else:
  '   qdf1.SQL = "...all orders..."
End Sub

Sub sistemaFiltroStagione Marchio()
  ' Costruisce WHERE clause dinamico da filtri UI:
  ' TempFiltro = "[Season Code]='" & FilterValue & "'"
  ' TempFiltro += " or [Season Code]='" & FilterValue2 & "'"
  ' ...
End Sub
```

**Pattern:** String concatenation di SQL (scarso, SQL injection risk!)

### Modulo1.bas Functions (Estratto)

```vba
Sub salvaFileTxt(nomefile, tabella, fieldseparator)
  ' Esporta tabella a CSV flat
  ' Usato per: data dumps, debug
End Sub

Sub CreaDatiPerFatturaElCorteInglesDaDDT(DdtNr)
  ' Estrae dati da DDT e popola tabella temp
  ' Logica specifica per El Corte Inglés export
End Sub
```

---

## 🚀 Porting Strategy (Fase 3 onwards)

### Cosa Portare

| Component | Destination | Priority |
|-----------|-------------|----------|
| **SQL queries** | `@luke/nav/src/statistics/` | 🔴 HIGH |
| **Margine logic** | `apps/api/src/services/margins.ts` | 🟠 MED |
| **Filtri UI** | `apps/web/components/AnalysisFilters.tsx` | 🟠 MED |
| **Export Excel** | `apps/api/src/services/excel.ts` (exceljs) | 🟠 MED |
| **VBA form logic** | `apps/web/hooks/useAnalysisForm.ts` | 🟡 LOW |

### Cosa NON Portare

- ✂️ Login form VBA (use Luke auth)
- ✂️ Label printing reports (use separate system)
- ✂️ Access-specific optimizations

### Query Porting Order (Consigliato)

1. **qSoloVend-step0** — Base sales extraction (semplice)
2. **qSoloVend-step1** — GROUP BY aggregation (medio)
3. **def01-ANALISIVENDUTO-PIVOT-step0** — SPLIT in 3 sub-queries (complesso)

---

## 📈 Data Volume Estimation

**Domande per il team:**

1. **Quante righe in Sales Line?** (per anno/stagione)
   - Determina strategia caching

2. **Quanti accessi/giorno?** (a def01 query)
   - Determina se cache Redis necessaria

3. **Timeout Excel acceptable?** (5s? 30s?)
   - Determina se query deve essere pre-computed nightly

4. **DatiCarryOverESMU è pre-computata?**
   - Chi la popola? VBA scheduled? Manual?
   - In Luke: diventa Stored Procedure scheduled

---

## ✅ Checklist Analisi

- [x] VBA modules letti (34 files)
- [x] Form_Principale semantica capita
- [x] Query pipeline def01-ANALISIVENDUTO identificata
- [x] 5 principali problemi identificati
- [x] 3 ottimizzazioni prioritarie proposte
- [ ] **→ PROSSIMO:** Analizzare SQL step-by-step per conversione Jet → T-SQL

---

## 📋 Next Step: SQL Deep Dive

Analisiamo `def01-ANALISIVENDUTO-PIVOT-step0` line by line:

1. **SELECT clause analysis** — 200+ campi, quali sono essenziali?
2. **FROM-JOIN analysis** — 12 JOINs, quali sono necessari? Quali ridondanti?
3. **Aggregation logic** — SUM, COUNT per field
4. **Calculation logic** — Margin, commission formulas
5. **Proposed splitting** — 3 step SQL queries

Iniziamo?

---

**Status:** 🟢 **VBA ANALYSIS COMPLETE**
