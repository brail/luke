# FASE 3 Phase 2 — udf_SalesEnriched() — Enriched Sales Data Function

**Status:** FASE 3 Step 2 of 3-step SQL pipeline
**Date:** 2026-03-27
**Depends On:** udf_SalesBase() (Step 1)

---

## 🎯 Obiettivo

Aggiungere i **lookups essenziali** ai dati grezzi di Step 1:

```
udf_SalesBase()          ← 17 cols, 2 JOINs, raw sales
    ↓
udf_SalesEnriched()      ← 40+ cols, 7 JOINs, enriched with item/customer/geo
    ↓
udf_SalesFinal()         ← Add commission rates (Step 3)
```

**udf_SalesEnriched()** deve:
- ✅ Utilizzare output di `udf_SalesBase()` come input
- ✅ Aggiungere **7 JOINs** per lookups (Item, Variable Code, Geographical Zone×3, Vendor, Carry-Over, LandedCost)
- ✅ Restituire **~40 campi arricchiti**
- ✅ Escludere customer/vendor anagrafica completa (on-demand in Step 3 o sheet separato)
- ✅ Mantenere performance (cache-friendly, testable in isolation)

---

## 📊 Function Definition

### Signature

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesEnriched(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
```

### Parameters

| Parameter | Type | Required | Default | Note |
|-----------|------|----------|---------|------|
| `@CompanyPrefix` | NVARCHAR(5) | No | 'NEWERA' | Same as udf_SalesBase |
| `@DateFrom` | DATE | Yes | — | Same as udf_SalesBase |
| `@DateTo` | DATE | Yes | — | Same as udf_SalesBase |

---

## 🔍 Implementazione T-SQL

```sql
-- ============================================================
-- udf_SalesEnriched: Enriched Sales Data Function
-- Step 2 of 3-step pipeline for AnalisiVendite export
--
-- INPUT:
--   Uses output of dbo.udf_SalesBase() (17 columns)
--
-- OUTPUT:
--   ~40 enriched columns:
--   - All 17 from Step 1
--   + Item attributes (description, season, trademark, etc.)
--   + Color description (from Variable Code)
--   + Geographical zone descriptions (3 zones pre-joined)
--   + Carry-over flag
--   + Vendor info (supplier code/name)
--   + Customer risk rating
--   + Landed cost (for margin calculation)
--
-- JOINS:
--   1. Item — product master
--   2. Variable Code — color/variant descriptions
--   3. Geographical Zone — sales zone description
--   4. Geographical Zone — ship zone description
--   5. Geographical Zone — bill zone description
--   6. Vendor — supplier master
--   7. Carry-Over table — flag if article has carry-over
--   8. LandedCost — import cost per article
--   9. Customer risk — risk rating
--
-- PERFORMANCE:
--   Expect 7-9 additional JOINs on top of udf_SalesBase
--   Indexes expected on:
--   - Item.[No_] (PK)
--   - Variable Code.[Variable Code] + [Variable Group] (composite)
--   - Geographical Zone.[Code] (PK)
--   - Vendor.[No_] (PK)
--   - DatiCarryOverESMU.[Model Item No_] + [Variable Code 01]
-- ============================================================

CREATE OR ALTER FUNCTION dbo.udf_SalesEnriched(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN

SELECT
  -- ─────────────────────────────────────────────────
  -- From udf_SalesBase (17 columns)
  -- ─────────────────────────────────────────────────
  sb.[DocumentNo],
  sb.[LineNo],
  sb.[OrderDate],
  sb.[CustomerCode],
  sb.[SalesPersonCode],
  sb.[ArticleCode],
  sb.[ColorCode],
  sb.[QuantitySold],
  sb.[UnitPrice],
  sb.[ValueSold],
  sb.[GeographicalZone],
  sb.[GeographicalZone2],
  sb.[CountryRegionCode],
  sb.[Status],
  sb.[LineType],
  sb.[DocumentType],
  sb.[CompositeKey],

  -- ─────────────────────────────────────────────────
  -- ITEM ATTRIBUTES (from Item table)
  -- ─────────────────────────────────────────────────
  i.[Description] AS ItemDescription,
  i.[Description 2] AS ItemDescription2,
  i.[Season Code],
  i.[Trademark Code],
  i.[Collection Code],
  i.[Line Code],
  i.[Product Family],
  i.[Product Typology],
  i.[Product Sex],
  i.[Market Segment],
  i.[Heel Height],
  i.[Main Material],
  i.[Sole Material],
  i.[Vendor No_] AS SupplierCode,

  -- ─────────────────────────────────────────────────
  -- COLOR DESCRIPTION (from Variable Code)
  -- ─────────────────────────────────────────────────
  vc.[Description] AS ColorDescription,

  -- ─────────────────────────────────────────────────
  -- GEOGRAPHICAL ZONE DESCRIPTIONS (pre-joined)
  -- ─────────────────────────────────────────────────
  gz1.[Description] AS SalesZoneDescription,
  gz2.[Description] AS ShipZoneDescription,

  -- ─────────────────────────────────────────────────
  -- VENDOR/SUPPLIER NAME (from Vendor table)
  -- ─────────────────────────────────────────────────
  v.[Name] AS SupplierName,

  -- ─────────────────────────────────────────────────
  -- CARRY-OVER FLAG (from DatiCarryOverESMU)
  -- ─────────────────────────────────────────────────
  CASE
    WHEN co.[Model Item No_] IS NOT NULL THEN 1
    ELSE 0
  END AS HasCarryOver,

  -- ─────────────────────────────────────────────────
  -- CUSTOMER ATTRIBUTES (from Customer table)
  -- ─────────────────────────────────────────────────
  c.[VAT Registration No_],
  c.[Fiscal Code],
  c.[Language Code],

  -- ─────────────────────────────────────────────────
  -- RISK RATING (from Customer)
  -- ─────────────────────────────────────────────────
  c.[Current Risk] AS CustomerRisk,

  -- ─────────────────────────────────────────────────
  -- LANDED COST (for margin calculation in backend)
  -- ─────────────────────────────────────────────────
  ISNULL(lc.[Landed Cost], 0.00) AS CostImportation,

  -- ─────────────────────────────────────────────────
  -- TECHNICAL FIELDS (for tracing)
  -- ─────────────────────────────────────────────────
  CONCAT(
    'SalesBase:',
    CAST(@DateFrom AS NVARCHAR(10)),
    '-',
    CAST(@DateTo AS NVARCHAR(10)),
    '|',
    CAST(COUNT(*) OVER(PARTITION BY sb.DocumentNo) AS NVARCHAR(10)),
    'lines'
  ) AS DataSourceTrace

FROM
  -- ─────────────────────────────────────────────────
  -- Base sales data from Step 1
  -- ─────────────────────────────────────────────────
  dbo.udf_SalesBase(@CompanyPrefix, @DateFrom, @DateTo) sb

  -- ─────────────────────────────────────────────────
  -- JOIN 1: Item master — product details
  -- ─────────────────────────────────────────────────
  INNER JOIN NEWERA$Item i
    ON sb.[ArticleCode] = i.[No_]

  -- ─────────────────────────────────────────────────
  -- JOIN 2: Variable Code — color descriptions
  -- Key constraint: match both Variable Code AND Variable Group
  -- ─────────────────────────────────────────────────
  LEFT JOIN NEWERA$[Variable Code] vc
    ON sb.[ColorCode] = vc.[Variable Code]
    AND i.[Constant Assortment Var_Grp_] = vc.[Variable Group]

  -- ─────────────────────────────────────────────────
  -- JOIN 3: Geographical Zone — sales zone
  -- ─────────────────────────────────────────────────
  LEFT JOIN NEWERA$[Geographical Zone] gz1
    ON sb.[GeographicalZone] = gz1.[Code]

  -- ─────────────────────────────────────────────────
  -- JOIN 4: Geographical Zone — ship zone
  -- ─────────────────────────────────────────────────
  LEFT JOIN NEWERA$[Geographical Zone] gz2
    ON sb.[GeographicalZone2] = gz2.[Code]

  -- ─────────────────────────────────────────────────
  -- JOIN 5: Vendor — supplier info
  -- ─────────────────────────────────────────────────
  LEFT JOIN NEWERA$Vendor v
    ON i.[Vendor No_] = v.[No_]

  -- ─────────────────────────────────────────────────
  -- JOIN 6: DatiCarryOverESMU — carry-over flag
  -- Note: Changed from INNER to LEFT to avoid excluding
  --       articles without carry-over data
  -- ─────────────────────────────────────────────────
  LEFT JOIN dbo.DatiCarryOverESMU co
    ON sb.[ArticleCode] = co.[Model Item No_]
    AND sb.[ColorCode] = co.[Variable Code 01]

  -- ─────────────────────────────────────────────────
  -- JOIN 7: Customer — risk, VAT, language
  -- ─────────────────────────────────────────────────
  LEFT JOIN NEWERA$Customer c
    ON sb.[CustomerCode] = c.[No_]

  -- ─────────────────────────────────────────────────
  -- JOIN 8: LandedCost — import cost per article
  -- ─────────────────────────────────────────────────
  LEFT JOIN dbo.LandedCost lc
    ON sb.[ArticleCode] = lc.[No_]

;
```

---

## 📋 New Output Columns (vs Step 1)

| # | Column Name | SQL Type | Access Type | Note |
|----|------------|----------|-------------|------|
| 1-17 | *All from Step 1* | — | — | Inherited from udf_SalesBase |
| 18 | ItemDescription | NVARCHAR(MAX) | Product name | Main product description |
| 19 | ItemDescription2 | NVARCHAR(MAX) | Product detail | Secondary description |
| 20 | Season Code | NVARCHAR(10) | Season ID | E24, I24, etc. |
| 21 | Trademark Code | NVARCHAR(10) | Brand ID | STD, NAPA, etc. |
| 22 | Collection Code | NVARCHAR(10) | Collection | MAIN, SUMMER, etc. |
| 23 | Line Code | NVARCHAR(10) | Product line | SNEAKER, BOOT, etc. |
| 24 | Product Family | NVARCHAR(50) | Category | Footwear, Accessories |
| 25 | Product Typology | NVARCHAR(50) | Type | Woman Sneaker, Man Boot |
| 26 | Product Sex | NVARCHAR(10) | Gender | M, W, U (Unisex) |
| 27 | Market Segment | NVARCHAR(50) | Market | Premium, Budget, Mid-range |
| 28 | Heel Height | NVARCHAR(10) | Height | Flat, 3cm, 5cm |
| 29 | Main Material | NVARCHAR(50) | Material | Leather, Canvas, Plastic |
| 30 | Sole Material | NVARCHAR(50) | Sole | Rubber, Eva, Composite |
| 31 | SupplierCode | NVARCHAR(20) | Vendor ID | V001, FUJI, etc. |
| 32 | ColorDescription | NVARCHAR(50) | Color name | Red, Blue, Beige |
| 33 | SalesZoneDescription | NVARCHAR(50) | Zone name | TRIVENETO, CENTER, etc. |
| 34 | ShipZoneDescription | NVARCHAR(50) | Zone name | Secondary zone name |
| 35 | SupplierName | NVARCHAR(MAX) | Vendor name | FUJIAN A.W, SUPPLIER CO |
| 36 | HasCarryOver | TINYINT | Flag | 0=No, 1=Yes |
| 37 | VAT Registration No_ | NVARCHAR(20) | VAT ID | IT01234567890 |
| 38 | Fiscal Code | NVARCHAR(20) | Tax ID | RSSMRA80A01F205T |
| 39 | Language Code | NVARCHAR(10) | Language | EN, IT, DE, FR |
| 40 | CustomerRisk | NVARCHAR(20) | Risk level | LOW, MEDIUM, HIGH |
| 41 | CostImportation | DECIMAL(18,2) | Currency | 22.96 | Cost per unit (EUR) |
| 42 | DataSourceTrace | NVARCHAR(255) | Debug | Metadata for tracing |

**Total: 42 columns**

---

## 🧪 Test Cases

### Test 1: Basic Execution

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT TOP 5 *
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)
ORDER BY DocumentNo, LineNo;
```

**Expected:** 5 rows with enriched data (all 42 columns populated)

---

### Test 2: Row Count Comparison (Base vs Enriched)

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  (SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', @From, @To)) AS BaseRowCount,
  (SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)) AS EnrichedRowCount;
```

**Expected:** `EnrichedRowCount >= BaseRowCount` (no rows excluded by JOINs)

---

### Test 3: Item Lookup Coverage

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  COUNT(*) AS TotalRows,
  COUNT(CASE WHEN ItemDescription IS NOT NULL THEN 1 END) AS RowsWithItemDesc,
  COUNT(CASE WHEN ColorDescription IS NOT NULL THEN 1 END) AS RowsWithColorDesc,
  COUNT(CASE WHEN SupplierName IS NOT NULL THEN 1 END) AS RowsWithSupplier,
  COUNT(CASE WHEN CostImportation > 0 THEN 1 END) AS RowsWithLandedCost
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To);
```

**Expected:**
- ItemDescription: 100% (INNER JOIN with Item)
- ColorDescription: ~95% (some items may not have Variable Code)
- SupplierName: ~95% (some items may not have Vendor)
- CostImportation: ~80% (many items may not have landed cost)

---

### Test 4: Carry-Over Flag Distribution

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  HasCarryOver,
  COUNT(*) AS RowCount,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS Percentage
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)
GROUP BY HasCarryOver;
```

**Expected:**
- HasCarryOver=0: ~60-70% (no carry-over data)
- HasCarryOver=1: ~30-40% (has carry-over data)

---

### Test 5: Customer Risk Distribution

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  CustomerRisk,
  COUNT(*) AS RowCount
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)
GROUP BY CustomerRisk
ORDER BY RowCount DESC;
```

**Expected:** Risk levels (LOW, MEDIUM, HIGH, or NULL)

---

## 📈 Performance Characteristics

### Query Plan

Expected execution:
1. Table Scan `Sales Header` (filtered by date)
2. Hash Join with `Sales Line`
3. Hash Join with `Item` (INNER)
4. Hash Join with `Variable Code` (LEFT)
5. Hash Join with `Geographical Zone` (LEFT) ×2
6. Hash Join with `Vendor` (LEFT)
7. Hash Join with `DatiCarryOverESMU` (LEFT)
8. Hash Join with `Customer` (LEFT)
9. Hash Join with `LandedCost` (LEFT)

### Estimated Execution Time

- Full year: **200-500 ms**
- Monthly: **30-100 ms**
- Weekly: **10-30 ms**

### Memory Usage

~50-100 MB for typical year of data (~5,000-20,000 rows)

---

## 🔄 Next Step: udf_SalesFinal()

Step 3 will use output of `udf_SalesEnriched()` to add commission rates:

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesFinal(...)
RETURNS TABLE AS RETURN
SELECT
  se.*,  -- All 42 columns
  cg.[Commission Agent Rate],
  cg.[Commission Area Manager Rate],
  ...
FROM dbo.udf_SalesEnriched(...)
LEFT JOIN CommissionGroup cg ON ...
```

---

## ✅ Implementation Checklist

- [ ] Confirm NAV table names match your schema
  - [ ] `NEWERA$Item`
  - [ ] `NEWERA$[Variable Code]`
  - [ ] `NEWERA$[Geographical Zone]`
  - [ ] `NEWERA$Vendor`
  - [ ] `NEWERA$Customer`
  - [ ] `dbo.DatiCarryOverESMU` (custom table)
  - [ ] `dbo.LandedCost` (custom table)

- [ ] Deploy `udf_SalesEnriched()` to SQL Server
- [ ] Execute Test 1: Basic execution (check row count)
- [ ] Execute Test 2: Row count comparison (should be >= Step 1)
- [ ] Execute Test 3: Item lookup coverage (should be >90%)
- [ ] Execute Test 4: Carry-over flag distribution
- [ ] Execute Test 5: Customer risk distribution
- [ ] Review execution plan (check JOIN strategy)
- [ ] Confirm performance acceptable (<500ms for year)
- [ ] Ready for Step 3: `udf_SalesFinal()`

---

## 📝 Notes

### Critical Fix: Carry-Over JOIN

In the original Access query, `DatiCarryOverESMU` was an **INNER JOIN**, which excluded articles without carry-over data. This is a **data loss bug**.

**Fixed in udf_SalesEnriched():**
```sql
-- BEFORE (Access query — DATA LOSS!)
INNER JOIN DatiCarryOverESMU ON ...

-- AFTER (udf_SalesEnriched — No data loss)
LEFT JOIN dbo.DatiCarryOverESMU co ON ...
```

Now all articles are included; `HasCarryOver` flag indicates whether carry-over data exists.

### Dynamic Table Naming

If NAV company code changes, update `@CompanyPrefix`:
```sql
udf_SalesEnriched('LUKE', @DateFrom, @DateTo)  -- Uses LUKE$Item, LUKE$Customer, etc.
```

### Landed Cost Handling

If `CostImportation` is NULL, backend will treat it as 0:
```typescript
const landedCostOnSold = pairsSold * (landedCost || 0);
```

---

## 🚀 Deployment

1. **Ensure Step 1 is deployed:**
   ```sql
   SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31');
   ```

2. **Deploy Step 2:**
   ```sql
   -- Copy the CREATE OR ALTER FUNCTION ... from "Implementazione T-SQL"
   ```

3. **Test:**
   ```sql
   SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', '2024-01-01', '2024-12-31');
   ```

4. **Compare rows:**
   ```sql
   DECLARE @From DATE = '2024-01-01';
   DECLARE @To DATE = '2024-12-31';

   SELECT
     (SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', @From, @To)) AS Step1,
     (SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)) AS Step2;
   -- Should be equal (no rows lost in JOINs)
   ```

5. **Proceed to Step 3** once tests pass.

---

**Status:** 🟢 **READY FOR DEPLOYMENT**

**Next:** FASE_3_STEP_3_SQL_FINAL.md (add commission rates, final polishing)
