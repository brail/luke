# SQL Deep Dive — def01-ANALISIVENDUTO-PIVOT-step0

## 📊 Query Anatomy

**Dimensione:** ~20,000 characters (2,700 chars senza formattazione)
**Righe SQL:** 1 SELECT mega-clause
**Complessità:** 11 JOINs (1 INNER + 10 LEFT)
**Campi:** 200+ colonne selezionate
**Calcoli:** 7 colonne derivate (margini, commissioni)

---

## 🔍 Analisi Dettagliata per Sezioni

### A. SELECT Clause — Campi Estratti (200+ campi)

#### Sezione A1: Base Document Fields (da qSoloVend-step1)
```sql
[qSoloVend-step1].[Document No_],      -- PK order
[qSoloVend-step1].[Line No_],           -- PK order line
[qSoloVend-step1].[Customer Order Ref_],
[qSoloVend-step1].Reference,
[qSoloVend-step1].[Gen_ Bus_ Posting Group],
[qSoloVend-step1].[VAT Bus_ Posting Group],
[qSoloVend-step1].[Customer Posting Group],
```

**Essenziali:** YES — Identificano ordine/riga
**Uso:** Filtri, report header

#### Sezione A2: Article Data (da qSoloVend-step1 + Item)
```sql
[qSoloVend-step1].Article,
[qSoloVend-step1].[Constant Variable Code],
[Variable Code].Description AS Color,
Item.Description,
Item.[Description 2],
Item.[Trademark Code],
Item.[Season Code],
Item.[Collection Code],
Item.[Line Code],
Item.[Vendor No_],
Item.[Country_Region of Origin Code],
...più 20 campi Item
```

**Essenziali:** YES
**Ridondanza:** Molti campi duplicati (Season, Vendor da qSoloVend-step1 e Item)
**Suggerimento:** Consolida in qSoloVend-step1 (già dovrebbe avere Item fields)

#### Sezione A3: Customer Data (da qSoloVend-step1 + Customer lookup)
```sql
[qSoloVend-step1].CustomerCode,
[qSoloVend-step1].CustomerName,
Customer.[Language Code],
Customer.[VAT Registration No_],
Customer.[Fiscal Code],
Customer.Address,
Customer.City,
Customer.County,
...più 30 campi Customer
```

**Essenziali:** 10-15 campi (code, name, address, VAT)
**Ridondanza:** 50+ campi di lookup anagrafico Customer
**Suggerimento:** Creando Excel: fetch solo essenziali qui, dati dettagli in second sheet o on-demand

#### Sezione A4: Commissioni & Provvigioni
```sql
[qSoloVend-step1].ProvvigioneAgente,           -- rate %
[qSoloVend-step1].ProvvigioneCapozona,
[qSoloVend-step1].ProvvigioneSoggetto1,
[qSoloVend-step1].ProvvigioneSoggetto2,
[qSoloVend-step1].ProvvigioneSoggetto3,
[qSoloVend-step1].ProvvigioneSoggetto4,
```

**Uso:** Calcoli margine in sezione A7

#### Sezione A5: Quantità & Valori (da qSoloVend-step1)
```sql
[qSoloVend-step1].QuantitySold,
[qSoloVend-step1].PairsSold,              -- unit (scarpe: coppie)
[qSoloVend-step1].ValueSold,              -- EUR importo
[qSoloVend-step1].QuantityShipped,
[qSoloVend-step1].PairsShipped,
[qSoloVend-step1].ValueShipped,
[qSoloVend-step1].QuantityInvoiced,
[qSoloVend-step1].PairsInvoiced,
[qSoloVend-step1].ValueInvoiced,
[qSoloVend-step1].QuantityReadyForShippingTotale,
[qSoloVend-step1].PairsReadyForShippingTotale,
[qSoloVend-step1].ValueReadyForShippingTotale,
[qSoloVend-step1].QuantityReadyForShippingRilasciate,
[qSoloVend-step1].PairsReadyForShippingRilasciate,
[qSoloVend-step1].ValueReadyForShippingRilasciate,
...ecc (più 6 varianti di "ReadyForShipping" stati)
```

**Osservazione:** 15+ colonne di "ReadyForShipping" con diversi stati WMS
- `Totale` = somma tutti
- `Rilasciate` = released to warehouse
- `Aperte` = open not yet released
- `DaInviareWMSps` = to be sent to WMS
- `InviatoWMSps` = sent to WMS
- `EvasoWMSps` = evaded (picked/shipped from WMS)

**Ridondanza:** Molti di questi campi sono **colonne di stato ridondanti**
- Se hai: `[ReadyForShippingTotale]` = sum
- Avere `[ReadyForShippingRilasciate]`, `[ReadyForShippingAperte]`, etc. → break down

**Suggerimento:** Per Excel, mostra solo `Rilasciate` + `Aperte` (summary), dettagli WMS in tab separato

#### Sezione A6: Lookup Geografici (3 zone)
```sql
[qSoloVend-step1].[Geographical Zone],
[Geographical Zone].Description AS GeographicalZoneDescription,
[qSoloVend-step1].[Geographical Zone 2],
[Geographical Zone_1].Description AS GeographicalZone2Description,
[qSoloVend-step1].ShipToGeographicalZone2,
[Geographical Zone_2].Description AS ShipToGeographicalZone2Description,
```

**Problema:** 3 JOINs su stessa tabella per 3 zone diverse
**Soluzione:** In qSoloVend-step1, aggiungere 3 colonne pre-lookup:
```sql
-- Instead of 3 separate JOINs in def01, have in qSoloVend-step1:
SalesZone.Description AS SalesZoneDescription,
ShipZone.Description AS ShipZoneDescription,
BillZone.Description AS BillZoneDescription,
```

#### Sezione A7: **Calcoli Marginali** (CRITICAL!)
```sql
LandedCost.[landed Cost],
[pairsSold]*([landed cost]) AS EstimatedLandedCostOnSold,
[ValueSold]-[pairsSold]*([landed cost]) AS EstimatedMargin,

[valuesold]*[provvigioneagente]/100 AS EstimatedCommissionSalesPerson,
[valuesold]*[provvigionecapozona]/100 AS EstimatedCommissionArewManager,
[valuesold]*[provvigionesoggetto1]/100 AS EstimatedCommissionSubject1,
[valuesold]*[provvigionesoggetto2]/100 AS EstimatedCommissionSubject2,
[valuesold]*[provvigionesoggetto3]/100 AS EstimatedCommissionSubject3,
[valuesold]*[provvigionesoggetto4]/100 AS EstimatedCommissionSubject4,

[EstimatedMargin]-
  [EstimatedCommissionSalesPerson]-
  [EstimatedCommissionArewManager]-
  [EstimatedCommissionSubject1]-
  [EstimatedCommissionSubject2]-
  [EstimatedCommissionSubject3]-
  [EstimatedCommissionSubject4]
AS EstimatedSecondMargin,
```

**Problema (ALTO):**
1. ❌ **Dipendenza da LandedCost NULL** — Se articolo non ha landed cost, EstimatedMargin = NULL
2. ❌ **Calcoli numerici in SQL** — Risk of rounding errors vs Excel/decimals
3. ❌ **7 colonne derivate calcolate in SELECT** — Difficile debug, manutenzione
4. ❌ **Commissioni moltiplicano 4 volte** → cascata errori se uno sbagliato

**Soluzione (CONSIGLIATA):**
```
Sposta tutti i calcoli a Backend TypeScript:

Query SQL → ritorna:
  - ValueSold (raw)
  - PairsSold
  - ProvvigioneAgente, CapoZona, Soggetti 1-4 (rates %)

Backend → calcola:
  const landedCostOnSold = pairsSold * landedCost;
  const margin = valueSold - landedCostOnSold;
  const commissions = {
    agent: valueSold * (provvigioneAgente / 100),
    areaManager: valueSold * (provvigioneCapozona / 100),
    subject1: valueSold * (provvigioneSoggetto1 / 100),
    subject2: valueSold * (provvigioneSoggetto2 / 100),
    subject3: valueSold * (provvigioneSoggetto3 / 100),
    subject4: valueSold * (provvigioneSoggetto4 / 100),
  };
  const totalCommissions = Object.values(commissions).reduce((a, b) => a + b, 0);
  const secondMargin = margin - totalCommissions;
```

**Benefici:**
- ✅ Type-safe (Decimal, BigInt)
- ✅ Testabile
- ✅ Riusabile (anche in API)
- ✅ Facile debug (breakpoint)
- ✅ Cache-friendly

---

### B. FROM-JOIN Clause — 11 Joins

```sql
FROM
  [qSoloVend-step1]

  -- JOIN 1: Item master
  INNER JOIN Item ON [qSoloVend-step1].Article = Item.No_

  -- JOIN 2: Color lookup
  INNER JOIN [Variable Code] ON
    ([qSoloVend-step1].ColorCode = [Variable Code].[Variable Code]) AND
    (Item.[Constant Assortment Var_Grp_] = [Variable Code].[Variable Group])

  -- JOIN 3: Customer master
  LEFT JOIN Customer ON [qSoloVend-step1].CustomerCode = Customer.No_

  -- JOIN 4: Vendor (item supplier)
  LEFT JOIN Vendor ON Item.[Vendor No_] = Vendor.No_

  -- JOIN 5: Carry-over (PROBLEMATICO!)
  INNER JOIN DatiCarryOverESMU ON
    ([qSoloVend-step1].Article = DatiCarryOverESMU.[Model Item No_]) AND
    ([qSoloVend-step1].[Constant Variable Code] = DatiCarryOverESMU.[Variable Code 01])

  -- JOIN 6: Must-buy flag
  LEFT JOIN [MustBuy-ArticoloColore] ON
    ([qSoloVend-step1].[Constant Variable Code] = [MustBuy-ArticoloColore].[Variable Code 01]) AND
    ([qSoloVend-step1].Article = [MustBuy-ArticoloColore].[Model Item No_])

  -- JOIN 7, 8, 9: Geographical zones (RIDONDANTE!)
  LEFT JOIN [Geographical Zone] ON [qSoloVend-step1].[Geographical Zone] = [Geographical Zone].Code
  LEFT JOIN [Geographical Zone] AS [Geographical Zone_1] ON [qSoloVend-step1].[Geographical Zone 2] = [Geographical Zone_1].Code
  LEFT JOIN [Geographical Zone] AS [Geographical Zone_2] ON [qSoloVend-step1].ShipToGeographicalZone2 = [Geographical Zone_2].Code

  -- JOIN 10: Vendor (manufacturer)
  LEFT JOIN Vendor AS Vendor_1 ON Item.Manufacturer = Vendor_1.No_

  -- JOIN 11: Landed cost
  LEFT JOIN LandedCost ON [qSoloVend-step1].Article = LandedCost.No_

  -- JOIN 12: Customer cross-reference
  LEFT JOIN CrossReferenceCliente ON
    ([qSoloVend-step1].Article = CrossReferenceCliente.[Model Item No_]) AND
    ([qSoloVend-step1].[Constant Variable Code] = CrossReferenceCliente.[Constant Variable Code]) AND
    ([qSoloVend-step1].[Bill-to Customer No_] = CrossReferenceCliente.[Cross-Reference Type No_])
```

#### Analisi Join

| # | Tabella | Type | Key | Essenziale? | Note |
|---|---------|------|-----|------------|------|
| 1 | Item | INNER | Article=No_ | ✅ YES | Descrizione, categoria |
| 2 | Variable Code | INNER | ColorCode, VarGroup | ✅ YES | Color description |
| 3 | Customer | LEFT | CustomerCode | ✅ YES | Anagrafica cliente |
| 4 | Vendor | LEFT | Item.Vendor=No_ | 🟠 MAYBE | Fornitore: essenziale? |
| 5 | DatiCarryOverESMU | **INNER** ⚠️ | Article, VarCode | 🔴 PROBLEM | **Esclude articoli senza carry-over!** |
| 6 | MustBuy | LEFT | Article, VarCode | 🟡 LOW | Flag must-buy: per reporting solo |
| 7 | Geog Zone | LEFT | Zone1 | 🟡 MED | Zone description: lookup |
| 8 | Geog Zone | LEFT | Zone2 | 🟡 MED | Redundant: 2 zone fields stesso join |
| 9 | Geog Zone | LEFT | Zone3 | 🟡 MED | Redundant: 3° zona, stessa tabella |
| 10 | Vendor | LEFT | Item.Manufacturer | 🟡 LOW | Manufacturer name: optional |
| 11 | LandedCost | LEFT | Article | 🟠 MAYBE | Costo importazione: per margine |
| 12 | CrossRefCliente | LEFT | Article, VarCode, BillTo | 🟡 LOW | Customer-specific SKU code |

#### Problemi Identificati

**🔴 CRITICAL: JOIN 5 è INNER, non LEFT!**

```sql
INNER JOIN DatiCarryOverESMU ON ...
```

**Impatto:**
- Se un articolo NON ha carry-over, viene ELIMINATO dalla query
- Quindi la query torna MENO righe di qSoloVend-step1
- **BUG?** Probabilmente intenzionale, ma rischioso

**Domanda:** Cosa è `DatiCarryOverESMU`?
- Tabella temporanea? Vista?
- Chi la popola?
- Contiene tutti i SKU?

**Soluzione:**
```sql
-- Change to LEFT JOIN:
LEFT JOIN DatiCarryOverESMU ON
  ([qSoloVend-step1].Article = DatiCarryOverESMU.[Model Item No_]) AND
  ([qSoloVend-step1].[Constant Variable Code] = DatiCarryOverESMU.[Variable Code 01])

-- Oppure: pre-populate carry-over in qSoloVend-step1 stessa
```

---

## 🎯 Proposta di Porting — Query Splitting

### Problema Attuale

```
def01-ANALISIVENDUTO-PIVOT-step0 (1 mega-query)
  - 20,000 chars
  - 11 JOINs
  - 200+ campi
  - 7 calcoli
  → Difficile da leggere, testare, ottimizzare
  → Risk di NULL propagation
```

### Soluzione Proposta: 3-Step Pipeline

#### **STEP 1: Sales_Base** (semplice, fast)

```sql
-- T-SQL: Sales_Base
CREATE OR ALTER FUNCTION dbo.udf_SalesBase(
  @CompanyPrefix NVARCHAR(5),
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
SELECT
  -- Key identifiers (minimal)
  sh.[No_] AS DocumentNo,
  sl.[Line No_] AS LineNo,
  sh.[Order Date],
  sh.[Sell-to Customer No_] AS CustomerCode,
  sl.No_ AS ArticleCode,
  sl.[Constant Variable Code] AS ColorCode,

  -- Quantities & Values (essential)
  sl.Quantity,
  sl.[Unit Price],
  sl.Amount AS ValueSold,

  -- Key fields for pivot/reporting
  sh.[Salesperson Code],
  c.[Geographical Zone],
  c.[Country_Region Code]

FROM NEWERA$[Sales Line] sl
INNER JOIN NEWERA$[Sales Header] sh ON sl.[Document No_] = sh.[No_]
LEFT JOIN NEWERA$Customer c ON sh.[Sell-to Customer No_] = c.No_

WHERE sh.[Order Date] BETWEEN @DateFrom AND @DateTo
  AND sh.[Status] NOT IN ('Draft', 'Archived')
  AND sl.Type = 20  -- Normal sales line
;
```

**Caratteristiche:**
- ✅ ~10 campi essenziali (vs 200+)
- ✅ 2 JOINs (vs 11)
- ✅ ~100 chars (vs 20,000)
- ✅ Testabile in isolation
- ✅ Cacheable

#### **STEP 2: Sales_Enriched** (medium)

```sql
-- T-SQL: Sales_Enriched
CREATE OR ALTER FUNCTION dbo.udf_SalesEnriched()
RETURNS TABLE AS RETURN
SELECT
  sb.*,

  -- Item lookups
  i.[Description],
  i.[Season Code],
  i.[Trademark Code],
  i.[Line Code],

  -- Color name
  vc.[Description] AS ColorDescription,

  -- Geographical zone descriptions
  gz.[Description] AS ZoneDescription,

  -- Carry-over flag
  CASE WHEN co.[Model Item No_] IS NOT NULL THEN 1 ELSE 0 END AS HasCarryOver,

  -- Customer risk
  c.[Current Risk] AS CustomerRisk,
  c.[VAT Registration No_],

  -- Landed cost
  lc.[Landed Cost] AS CostImportation

FROM dbo.udf_SalesBase() sb
INNER JOIN NEWERA$Item i ON sb.ArticleCode = i.No_
INNER JOIN NEWERA$[Variable Code] vc ON sb.ColorCode = vc.[Variable Code] AND i.[Constant Assortment Var_Grp_] = vc.[Variable Group]
LEFT JOIN NEWERA$[Geographical Zone] gz ON sb.[Geographical Zone] = gz.Code
LEFT JOIN DatiCarryOverESMU co ON sb.ArticleCode = co.[Model Item No_] AND sb.ColorCode = co.[Variable Code 01]
LEFT JOIN NEWERA$Customer c ON sb.CustomerCode = c.No_
LEFT JOIN LandedCost lc ON sb.ArticleCode = lc.No_
;
```

**Caratteristiche:**
- ✅ ~40 campi (vs 200+)
- ✅ 7 JOINs (vs 11, reduced)
- ✅ Escludi customer/vendor anagrafica completa
- ✅ Escludi commissioni (faremo in step 3)

#### **STEP 3: Sales_Final** (con calcoli)

```sql
-- T-SQL: Sales_Final
CREATE OR ALTER FUNCTION dbo.udf_SalesFinal()
RETURNS TABLE AS RETURN
SELECT
  se.*,

  -- Calcoli marini (restituisci raw values per che backend calcoli)
  se.[CostImportation],
  se.[ValueSold],

  -- Commission rates from commissiongroup lookup
  cg.[Rate_Agent] AS CommissionAgentRate,
  cg.[Rate_AreaManager] AS CommissionAreaManagerRate

FROM dbo.udf_SalesEnriched() se
LEFT JOIN CommissionGroup cg ON se.[Salesperson Code] = cg.[Salesperson Code]
;
```

**Caratteristiche:**
- ✅ Raw values per calcoli backend
- ✅ NO formula calcolate in SQL
- ✅ Backend farà: `margin = valueSold - (pairs * cost)`

---

## 📊 Mapping Campi per Excel

### Sheet 1: Sales Summary
```
DocumentNo | CustomerCode | ArticleCode | ColorCode |
Quantity   | Value        |
CustomerZone | Season | Status | CommissionRate
```
*Campi di base, ~15 colonne*

### Sheet 2: Enriched Data
```
[da Sales_Enriched]
+ Customer details (anagrafica)
+ Item attributes (category, family, etc.)
+ Carry-over flag
+ Risk rating
```

### Sheet 3: Calculations
```
[da Backend]
+ EstimatedLandedCost
+ EstimatedMargin
+ CommissionAgent, CommissionAreaManager, etc.
+ SecondMargin (dopo commissioni)
```

---

## ✅ Porting Checklist — def01-ANALISIVENDUTO-PIVOT-step0

### Step 1: Conversione Jet → T-SQL (automatico)

- [ ] Cambia `[NEWERA$Table]` → T-SQL compatible (già OK)
- [ ] Date literals `#...#` → `'YYYY-MM-DD'`
- [ ] `IIf()` → `CASE WHEN`
- [ ] `Val()` → `CAST(... AS DECIMAL)`

### Step 2: Split in 3 Queries

- [ ] Crea `udf_SalesBase()` — base sales + customer lookup
- [ ] Crea `udf_SalesEnriched()` — add item, color, zones, carry-over
- [ ] Crea `udf_SalesFinal()` — add commission rates
- [ ] Test: ogni function deve avere row count >= passo precedente

### Step 3: Backend Calculations

- [ ] Crea `calculateMargins(rows)` in `apps/api/src/services/margins.ts`
- [ ] Input: `SalesFinal[]` rows da SQL
- [ ] Output: rows con campi calcolati (margin, commissioni, secondMargin)
- [ ] Unit tests con edge cases (NULL costs, zero sales, etc.)

### Step 4: Excel Export

- [ ] Template `AnalisiVendite.xlsx` con 3 sheets
- [ ] Sheet 1: Sales summary (pivot)
- [ ] Sheet 2: Details (raw)
- [ ] Sheet 3: Margin analysis
- [ ] Formula Excel per subtotals

### Step 5: Integration

- [ ] tRPC endpoint `/api/analysis/sales` con filters
- [ ] Frontend dashboard component
- [ ] Export button → Excel

---

## 🚀 Effort Estimate

| Task | Days | Notes |
|------|------|-------|
| **Jet → T-SQL conversion** | 0.5 | Regex + manual cleanup |
| **Query splitting (3 functions)** | 1.0 | Test each step |
| **Margin calculations (backend)** | 1.0 | Decimal precision, edge cases |
| **Excel template + export** | 1.5 | exceljs integration |
| **tRPC endpoint + Frontend** | 1.5 | Dashboard + filters |
| **Testing & optimization** | 1.0 | Performance, validation |
| **Total** | **6 days** | |

---

**Status:** 🟢 **SQL DEEP DIVE COMPLETE**

**Ready for:** Conversion T-SQL step 1 (base query)
