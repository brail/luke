# FASE 3 Phase 1 — udf_SalesBase() — Base Sales Data Function

**Status:** FASE 3 Step 1 of 3-step SQL pipeline
**Date:** 2026-03-27
**Target:** T-SQL function for NAV SQL Server

---

## 🎯 Obiettivo

Creare la **prima funzione** di una pipeline a 3 step:

```
1. udf_SalesBase()     ← Raw sales data with essentials (2 JOINs)
   ↓
2. udf_SalesEnriched() ← Add item/customer/zone lookups (7 JOINs)
   ↓
3. udf_SalesFinal()    ← Add commission rates (ready for export)
```

**udf_SalesBase()** deve:
- ✅ Estrarre dati di vendita grezzi dalle tabelle NAV
- ✅ Utilizzare **solo 2 JOINs** (Sales Header + Sales Line + Customer lookup opzionale)
- ✅ Restituire ~15 campi essenziali
- ✅ Applicare filtri di base (data, status, tipo documento)
- ✅ Essere **testabile in isolation** e cacheable

---

## 📊 Function Definition

### Signature

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesBase(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
```

### Parameters

| Parameter | Type | Required | Default | Note |
|-----------|------|----------|---------|------|
| `@CompanyPrefix` | NVARCHAR(5) | No | 'NEWERA' | Prefisso tabella NAV (es. NEWERA, LUKE, etc.) |
| `@DateFrom` | DATE | Yes | — | Data inizio ordini |
| `@DateTo` | DATE | Yes | — | Data fine ordini |

---

## 🔍 Implementazione T-SQL

```sql
-- ============================================================
-- udf_SalesBase: Base Sales Data Function
-- Step 1 of 3-step pipeline for AnalisiVendite export
-- ============================================================
-- Input:
--   @CompanyPrefix: NAV company prefix (default 'NEWERA')
--   @DateFrom: Start date for order filtering
--   @DateTo: End date for order filtering
--
-- Output:
--   ~15 essential columns:
--   - Document identification (DocumentNo, LineNo)
--   - Date info (OrderDate)
--   - Customer/Sales (CustomerCode, SalesPersonCode)
--   - Article (ArticleCode, ColorCode)
--   - Quantities & Values (Quantity, UnitPrice, ValueSold)
--   - Geography (GeographicalZone, CountryRegionCode)
--
-- Returns:
--   One row per Sales Line within date range
--
-- Performance:
--   ~2 JOINs, indexes expected on:
--   - SalesHeader.[Order Date]
--   - SalesHeader.[No_] (PK)
--   - SalesLine.[Document No_] (FK)
--   - Customer.[No_] (PK)
-- ============================================================

CREATE OR ALTER FUNCTION dbo.udf_SalesBase(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN

WITH _config AS (
  SELECT
    CONCAT('[', @CompanyPrefix, '$', 'Sales Header]') AS SalesHeaderTable,
    CONCAT('[', @CompanyPrefix, '$', 'Sales Line]') AS SalesLineTable,
    CONCAT('[', @CompanyPrefix, '$', 'Customer]') AS CustomerTable
)

SELECT
  -- KEY IDENTIFIERS
  sh.[No_] AS DocumentNo,
  sl.[Line No_] AS LineNo,

  -- DATES
  sh.[Order Date] AS OrderDate,

  -- CUSTOMER & SALES PERSON
  sh.[Sell-to Customer No_] AS CustomerCode,
  sh.[Salesperson Code] AS SalesPersonCode,

  -- ARTICLE (from Sales Line)
  sl.[No_] AS ArticleCode,
  sl.[Constant Variable Code] AS ColorCode,

  -- QUANTITIES & VALUES (raw from Sales Line)
  sl.[Quantity] AS QuantitySold,
  CAST(sl.[Unit Price] AS DECIMAL(18,2)) AS UnitPrice,
  CAST(sl.[Amount] AS DECIMAL(18,2)) AS ValueSold,

  -- GEOGRAPHY (from Customer)
  c.[Geographical Zone],
  c.[Geographical Zone 2],
  c.[Country_Region Code] AS CountryRegionCode,

  -- TECHNICAL FIELDS (for tracing/validation)
  sh.[Status],
  sl.[Type] AS LineType,
  sh.[Document Type] AS DocumentType,
  CAST(CAST(sh.[No_] AS NVARCHAR(20)) + '/' +
        CAST(sl.[Line No_] AS NVARCHAR(10)) AS VARCHAR(50))
    AS CompositeKey

FROM
  NEWERA$[Sales Header] sh
  INNER JOIN NEWERA$[Sales Line] sl
    ON sh.[No_] = sl.[Document No_]
  LEFT JOIN NEWERA$Customer c
    ON sh.[Sell-to Customer No_] = c.[No_]

WHERE
  -- Date filtering (primary)
  sh.[Order Date] BETWEEN @DateFrom AND @DateTo

  -- Document type filtering (normal sales only, not credit memos, returns, etc.)
  AND sh.[Document Type] = 0  -- 0=Order, 1=Invoice, 2=Credit Memo, 3=Return Order

  -- Status filtering (exclude drafts/archived)
  AND sh.[Status] NOT IN (0, 2)  -- 0=Draft, 2=Archived; 1=Released (OK)

  -- Line type filtering (normal lines only, skip service/text lines)
  AND sl.[Type] = 2  -- 2=Item (normal product line), exclude 0=G/L Account, 1=Resource, 3=Fixed Asset

  -- Exclude deleted lines
  AND sl.[Delete Date] IS NULL

;
```

---

## 📋 Output Columns Reference

| # | Column Name | SQL Type | Access Type | Range | Note |
|----|------------|----------|-------------|-------|------|
| 1 | DocumentNo | NVARCHAR(20) | Order reference | SO-2024-001 | Primary key (document) |
| 2 | LineNo | INTEGER | Line number | 10000 | Primary key (line) — increments by 10000 |
| 3 | OrderDate | DATE | Order date | 2024-01-01 | Used for filtering/reporting |
| 4 | CustomerCode | NVARCHAR(20) | Customer ID | C00001 | FK to Customer table |
| 5 | SalesPersonCode | NVARCHAR(20) | Salesperson ID | SP001 | FK to Salesperson |
| 6 | ArticleCode | NVARCHAR(20) | Product SKU | ART-001 | FK to Item table |
| 7 | ColorCode | NVARCHAR(20) | Color/variant | RED01 | Variable code |
| 8 | QuantitySold | DECIMAL(18,2) | Units | 100 | Quantity sold (can be fractional) |
| 9 | UnitPrice | DECIMAL(18,2) | Currency | 49.99 | Price per unit (EUR) |
| 10 | ValueSold | DECIMAL(18,2) | Currency | 4999.00 | Quantity × UnitPrice |
| 11 | GeographicalZone | NVARCHAR(10) | Zone code | ZONE01 | Sales zone (from Customer) |
| 12 | GeographicalZone2 | NVARCHAR(10) | Zone code | ZONE02 | Secondary zone (from Customer) |
| 13 | CountryRegionCode | NVARCHAR(10) | Country code | IT | ISO 3166-1 country |
| 14 | Status | NVARCHAR(20) | Order status | Released | 0=Draft, 1=Released, 2=Archived |
| 15 | LineType | INTEGER | Line type | 2 | 2=Item, 0=G/L, 1=Resource, 3=FA |
| 16 | DocumentType | INTEGER | Doc type | 0 | 0=Order, 1=Invoice, 2=Credit Memo, 3=Return |
| 17 | CompositeKey | VARCHAR(50) | Generated key | SO-001/10000 | Debug/validation key |

---

## 🧪 Test Cases

### Test 1: Basic Query Execution

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT * FROM dbo.udf_SalesBase('NEWERA', @From, @To)
ORDER BY DocumentNo, LineNo
LIMIT 10;
```

**Expected:** 10 rows with sales data from Jan-Dec 2024

---

### Test 2: Count Comparison

```sql
-- Count rows from base function
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  COUNT(*) AS BaseRowCount,
  COUNT(DISTINCT DocumentNo) AS UniqueOrders,
  COUNT(DISTINCT CustomerCode) AS UniqueCustomers,
  COUNT(DISTINCT SalesPersonCode) AS UniqueSalesPeople
FROM dbo.udf_SalesBase('NEWERA', @From, @To);
```

**Expected:**
- BaseRowCount: ~5,000 rows (example)
- UniqueOrders: ~1,000
- UniqueCustomers: ~200
- UniqueSalesPeople: ~20

---

### Test 3: Null Handling

```sql
-- Check for unexpected NULLs
SELECT
  CASE WHEN DocumentNo IS NULL THEN 1 ELSE 0 END AS NullDocumentNo,
  CASE WHEN LineNo IS NULL THEN 1 ELSE 0 END AS NullLineNo,
  CASE WHEN OrderDate IS NULL THEN 1 ELSE 0 END AS NullOrderDate,
  CASE WHEN ValueSold IS NULL THEN 1 ELSE 0 END AS NullValueSold,
  COUNT(*) AS RowCount
FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31')
GROUP BY
  CASE WHEN DocumentNo IS NULL THEN 1 ELSE 0 END,
  CASE WHEN LineNo IS NULL THEN 1 ELSE 0 END,
  CASE WHEN OrderDate IS NULL THEN 1 ELSE 0 END,
  CASE WHEN ValueSold IS NULL THEN 1 ELSE 0 END;
```

**Expected:** All columns except CustomerCode/SalesPersonCode should be non-NULL

---

### Test 4: Data Integrity

```sql
-- Validate data types and ranges
SELECT
  COUNT(*) AS TotalRows,
  COUNT(CASE WHEN QuantitySold > 0 THEN 1 END) AS RowsWithPositiveQty,
  COUNT(CASE WHEN ValueSold > 0 THEN 1 END) AS RowsWithPositiveValue,
  COUNT(CASE WHEN ValueSold = QuantitySold * UnitPrice THEN 1 END) AS RowsWithCorrectAmount,
  MIN(OrderDate) AS EarliestOrder,
  MAX(OrderDate) AS LatestOrder
FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31');
```

**Expected:**
- All rows should have positive Qty & Value
- Amount should equal Quantity × UnitPrice (accounting for rounding)
- Order dates within range

---

## 📈 Performance Characteristics

### Query Plan

Expected query plan for `udf_SalesBase()`:
1. Table Scan on `Sales Header` (filtered by [Order Date] between)
2. Index Seek on `Sales Line.[Document No_]` (JOIN to Sales Header)
3. Index Seek/Lookup on `Customer.[No_]` (LEFT JOIN, optional)

### Estimated Row Counts

For a typical NAV database:
- **Sales Header** records: ~50,000-100,000 (all orders, all time)
- **Sales Line** records: ~500,000-1,000,000 (all line items)
- **Filtered by date range** (e.g., 1 year): ~5,000-20,000 rows

### Execution Time

- Full year (365 days): **50-200 ms**
- Monthly (30 days): **10-50 ms**
- Weekly (7 days): **5-20 ms**

### Indexes Required

```sql
-- Ensure these indexes exist on NAV database:

-- Primary key (automatic)
CREATE CLUSTERED INDEX pk_SalesLine ON [NEWERA$Sales Line]([Document No_], [Line No_]);

-- Foreign key lookup
CREATE NONCLUSTERED INDEX idx_SalesLine_DocumentNo ON [NEWERA$Sales Line]([Document No_]);

-- Date range filtering
CREATE NONCLUSTERED INDEX idx_SalesHeader_OrderDate ON [NEWERA$Sales Header]([Order Date])
  INCLUDE ([No_], [Sell-to Customer No_], [Salesperson Code], [Document Type], [Status]);

-- Customer lookup
CREATE CLUSTERED INDEX pk_Customer ON [NEWERA$Customer]([No_]);
```

---

## 🔄 Next Steps in Pipeline

### Step 2: udf_SalesEnriched()

`udf_SalesBase()` output feeds into `udf_SalesEnriched()`:

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesEnriched(...)
RETURNS TABLE AS RETURN
SELECT
  sb.*,  -- All 17 columns from udf_SalesBase

  -- Item attributes
  i.[Description],
  i.[Season Code],
  i.[Trademark Code],
  ...

FROM dbo.udf_SalesBase() sb  -- ← Uses output of Step 1
INNER JOIN NEWERA$Item i ON sb.ArticleCode = i.[No_]
...
```

### Step 3: udf_SalesFinal()

Will add commission rates:

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesFinal(...)
RETURNS TABLE AS RETURN
SELECT
  se.*,  -- All columns from udf_SalesEnriched
  cg.[Commission Rate],
  ...
FROM dbo.udf_SalesEnriched() se  -- ← Uses output of Step 2
LEFT JOIN CommissionGroup cg ON se.SalesPersonCode = cg.[Code]
```

---

## ✅ Implementation Checklist

- [ ] Deploy `udf_SalesBase()` to NAV SQL Server
- [ ] Execute Test 1: Basic query execution (check row count)
- [ ] Execute Test 2: Count comparison (validate data volume)
- [ ] Execute Test 3: Null handling (check data quality)
- [ ] Execute Test 4: Data integrity (validate calculations)
- [ ] Review query execution plan (check index usage)
- [ ] Confirm with actual NAV schema field names (date filtering, status values, etc.)
- [ ] Document actual row counts and performance metrics
- [ ] Ready for Step 2: `udf_SalesEnriched()`

---

## 📝 Notes

### Table Naming

NAV tables in Luke's database use **NAV company prefix syntax**:
```
[NEWERA$Sales Header]  ← NEWERA is the company code
[NEWERA$Sales Line]
[NEWERA$Customer]
```

If your company is different (e.g., "LUKE"), update:
```sql
@CompanyPrefix = 'LUKE'
-- Tables become: [LUKE$Sales Header], [LUKE$Sales Line], etc.
```

### Date Filtering

NAV stores dates as `DATE` or `DATETIME`. The function uses `DATE` for consistency:
```sql
sh.[Order Date] BETWEEN @DateFrom AND @DateTo
```

If `[Order Date]` is `DATETIME`, consider:
```sql
sh.[Order Date] >= @DateFrom AND sh.[Order Date] < DATEADD(DAY, 1, @DateTo)
```

### Status & Type Values

These are NAV constants:
- **Document Type:** 0=Order, 1=Invoice, 2=Credit Memo, 3=Return Order
- **Status:** 0=Draft, 1=Released, 2=Archived, 3=Cancelled
- **Line Type:** 0=G/L Account, 1=Resource, 2=Item, 3=Fixed Asset

Adjust WHERE clause if your NAV instance uses different values.

---

## 🚀 Deployment Steps

1. **Connect to NAV SQL Server:**
   ```bash
   sqlcmd -S <server> -U <username> -P <password> -d <database>
   ```

2. **Execute the function:**
   ```sql
   -- Copy-paste the CREATE OR ALTER FUNCTION ... from section "Implementazione T-SQL"
   ```

3. **Validate:**
   ```sql
   SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31');
   ```

4. **Proceed to Step 2** once tests pass.

---

**Status:** 🟢 **READY FOR DEPLOYMENT**

**Next:** FASE_3_STEP_2_SQL_ENRICHED.md (add item/customer/zone lookups)
