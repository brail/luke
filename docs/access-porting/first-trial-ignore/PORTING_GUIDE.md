# Porting Guide — Access Jet SQL → T-SQL for SQL Server

## Panoramica

Questo documento descrive come convertire le 1111 query estratte da NewEraStat.accdb (Access Jet SQL) a T-SQL per SQL Server, mantenendo semantica identica.

---

## 📋 Conversion Patterns

### 1. Date Literals

**Access Jet SQL:**
```sql
WHERE OrderDate > #2023-01-01#
```

**T-SQL SQL Server:**
```sql
WHERE OrderDate > '2023-01-01'  -- YYYY-MM-DD format
-- OR
WHERE OrderDate > CAST('2023-01-01' AS DATE)
```

**Migration script:**
```bash
# Find and replace all date literals
sed -i 's/#\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)#/'\''\1'\''/g' *.sql
```

---

### 2. String Concatenation

**Access Jet SQL:**
```sql
SELECT FirstName & " " & LastName AS FullName
```

**T-SQL SQL Server:**
```sql
SELECT FirstName + ' ' + LastName AS FullName
-- OR (safer for NULLs)
SELECT CONCAT(FirstName, ' ', LastName) AS FullName
-- OR (SQL 2012+)
SELECT FirstName + ' ' + LastName AS FullName  -- handles NULLs with SET CONCAT_NULL_YIELDS_NULL OFF
```

**Conversion:**
- Replace `&` with `+`
- Wrap NULLable columns: `ISNULL(column, '')`

---

### 3. Conditional Logic — IIf()

**Access Jet SQL:**
```sql
SELECT
  IIf([Amount] > 0, 'Credit', 'Debit') AS Type,
  IIf(IsNull([DatePaid]), 'Open', 'Closed') AS Status
```

**T-SQL SQL Server:**
```sql
SELECT
  CASE WHEN [Amount] > 0 THEN 'Credit' ELSE 'Debit' END AS Type,
  CASE WHEN [DatePaid] IS NULL THEN 'Open' ELSE 'Closed' END AS Status
```

**Pattern:**
```
IIf(condition, true_val, false_val)
    ↓
CASE WHEN condition THEN true_val ELSE false_val END
```

---

### 4. NULL Handling

**Access Jet SQL:**
```sql
WHERE IsNull(Column)  -- Check if NULL
WHERE Not IsNull(Column)  -- Check if NOT NULL
```

**T-SQL SQL Server:**
```sql
WHERE Column IS NULL  -- Check if NULL
WHERE Column IS NOT NULL  -- Check if NOT NULL
```

---

### 5. Type Casting — Val()

**Access Jet SQL:**
```sql
Sum(Val([Amount]))  -- Forces numeric conversion
Sum(Val([Quantity]) * Val([Price]))
```

**T-SQL SQL Server:**
```sql
SUM(CAST([Amount] AS DECIMAL(18,4)))  -- Explicit type
SUM(CAST([Quantity] AS INT) * CAST([Price] AS DECIMAL(18,4)))
-- OR (if already numeric)
SUM([Amount])  -- If [Amount] is already numeric type
```

**Strategy:**
- Remove `Val()` if column is already numeric type
- Use `CAST()` or `CONVERT()` if conversion needed
- Specify precision/scale: `DECIMAL(18,4)`

---

### 6. Math Functions

| Access | T-SQL | Notes |
|--------|-------|-------|
| `MOD(a, b)` | `a % b` | Modulo operator |
| `Abs(x)` | `ABS(x)` | Absolute value (same) |
| `Int(x)` | `CAST(x AS INT)` | Integer truncation |
| `Round(x, decimals)` | `ROUND(x, decimals)` | Round (same) |
| `Sgn(x)` | `SIGN(x)` | Sign (-1, 0, 1) |

---

### 7. Date Functions

| Access | T-SQL | Notes |
|--------|-------|-------|
| `Date()` | `CAST(GETDATE() AS DATE)` | Today's date |
| `DateValue(string)` | `CAST(string AS DATE)` | Parse date string |
| `Day(date)` | `DAY(date)` | Day of month (same) |
| `Month(date)` | `MONTH(date)` | Month (same) |
| `Year(date)` | `YEAR(date)` | Year (same) |
| `DateDiff('d', d1, d2)` | `DATEDIFF(DAY, d1, d2)` | **Parametri invertiti!** |
| `DateAdd('m', 1, date)` | `DATEADD(MONTH, 1, date)` | Add interval (stesso ordine) |

**CRITICAL:** Access `DateDiff` ha ordine `(unit, date1, date2)` ma SQL Server è `(unit, date1, date2)` — VERIFICA!

---

### 8. String Functions

| Access | T-SQL | Notes |
|--------|-------|-------|
| `Len(string)` | `LEN(string)` | Length (same) |
| `Left(string, n)` | `LEFT(string, n)` | Left substring (same) |
| `Right(string, n)` | `RIGHT(string, n)` | Right substring (same) |
| `Mid(string, start, len)` | `SUBSTRING(string, start, len)` | Substring (same) |
| `Ucase(string)` | `UPPER(string)` | Uppercase (same) |
| `Lcase(string)` | `LOWER(string)` | Lowercase (same) |
| `Trim(string)` | `TRIM(string)` | Remove spaces (same in 2017+) |
| `LTrim(string)` | `LTRIM(string)` | Remove left spaces |
| `RTrim(string)` | `RTRIM(string)` | Remove right spaces |
| `Replace(s, old, new)` | `REPLACE(s, old, new)` | Replace substring (same) |
| `Instr(s1, s2)` | `CHARINDEX(s2, s1)` | **Parametri invertiti!** |

---

### 9. DISTINCT ROW

**Access:**
```sql
SELECT DISTINCT ROW [Field1], [Field2] FROM Table
```

**T-SQL:**
```sql
SELECT DISTINCT [Field1], [Field2] FROM Table
```

(Rimuovi `ROW` — è un remnant Access)

---

### 10. Field Names with Spaces

**Access:**
```sql
SELECT [Order Date], [Sell-to Customer No_]
FROM [Sales Header]
```

**T-SQL:** (Uguale!)
```sql
SELECT [Order Date], [Sell-to Customer No_]
FROM [NEWERA$Sales Header]
```

(Mantieni square brackets `[]` per nomi con spazi/caratteri speciali)

---

## 🔧 Automated Conversion Tools

### Python Script Template

```python
import re

def convert_access_to_tsql(sql):
    """Convert Access SQL to T-SQL."""

    # 1. Date literals: #2023-01-01# → '2023-01-01'
    sql = re.sub(r'#(\d{4}-\d{2}-\d{2})#', r"'\1'", sql)

    # 2. String concat: & → +
    sql = sql.replace(' & ', ' + ')

    # 3. IIf → CASE WHEN
    # (Complex: use regex or manual for each query)

    # 4. MOD → %
    sql = re.sub(r'\bMOD\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)', r'\1 % \2', sql, flags=re.IGNORECASE)

    # 5. Val( → CAST(... AS DECIMAL)
    # (Manual or context-aware)

    # 6. Remove DISTINCT ROW
    sql = sql.replace('DISTINCT ROW', 'DISTINCT')

    return sql
```

---

## 🎯 Porting by Complexity

### Classe 1: Semplice (90%)

**Caratteristiche:**
- SELECT semplice, senza JOINs o pochissimi
- Filtri WHERE elementari
- No IIf, no funzioni complesse

**Tempo:** 5-10 minuti per query
**Esempio:** `0-NEWERA-PARTITECLIENTI-STEP0.sql`

**Step:**
1. Copia SQL
2. Converti date literals: `#...#` → `'...'`
3. Converti `Val()` → `CAST()`
4. Replace `&` → `+`
5. Remove `DISTINCT ROW` → `DISTINCT`
6. Test

### Classe 2: Medio (8%)

**Caratteristiche:**
- 2-3 JOIN
- Aggregazioni (SUM, COUNT, AVG)
- 5-15 IIf functions
- Subquery semplice

**Tempo:** 20-30 minuti per query
**Esempio:** `qSoloVendItem-step1.sql` (visto sopra)

**Step:**
1. Classe 1 conversion
2. Converti tutti gli `IIf()` → `CASE WHEN`
3. Verifica precisione `SUM()` e `CAST()`
4. Controlla HAVING clause
5. Test con dati campione

### Classe 3: Complessa (2%)

**Caratteristiche:**
- PIVOT queries
- CTE ricorsive
- Subquery annidati
- Dipendenze query multiple

**Tempo:** 1-2 ore per query
**Esempio:** `def01-ANALISIVENDUTO-PIVOT-step0.sql`

**Conversione PIVOT Access → T-SQL:**

**Access PIVOT:**
```sql
TRANSFORM Sum(Sales)
SELECT Customer
FROM Orders
GROUP BY Customer
PIVOT Month
```

**T-SQL PIVOT:**
```sql
SELECT
  Customer,
  [1] AS Jan, [2] AS Feb, [3] AS Mar, ...
FROM (
  SELECT Customer, Month, Sales FROM Orders
) AS SourceTable
PIVOT (
  SUM(Sales)
  FOR Month IN ([1], [2], [3], ...)
) AS PivotTable
```

---

## 📋 Porting Checklist per Query

Crea un file checklist per tracking:

```markdown
## QRY_NNN: [Nome Query]

- [ ] **Estrazione SQL** da `queries/custom/q2/queries/`
- [ ] **Parsing**
  - [ ] Identifica type (SELECT, ACTION, TRANSFORM/PIVOT)
  - [ ] Identifica JOINs
  - [ ] Identifica funzioni speciali (IIf, Val, DateDiff, ecc.)
  - [ ] Conta complessità
- [ ] **Conversione**
  - [ ] Date literals: #...# → '...'
  - [ ] String concat: & → +
  - [ ] IIf() → CASE WHEN
  - [ ] Val() → CAST()
  - [ ] Date functions
  - [ ] DISTINCT ROW → DISTINCT
- [ ] **Syntax Check**
  - [ ] Run: `sqlcmd -U sa -P <pwd> -d NAV < query.sql`
  - [ ] Zero errors
- [ ] **Data Validation**
  - [ ] Run query in SQL Server
  - [ ] Compare row count with Access
  - [ ] Sample output match
- [ ] **Documentation**
  - [ ] Header comment: source, purpose, params
  - [ ] Dependencies documented
  - [ ] Known limitations noted
- [ ] **Integration**
  - [ ] Add to `@luke/nav/src/statistics/queries/`
  - [ ] Export function in `index.ts`
  - [ ] Add Zod schema for output
  - [ ] Add tRPC endpoint
- [ ] **Testing**
  - [ ] Unit test (valid rows)
  - [ ] Edge case test (empty, NULL, date boundaries)
  - [ ] Performance test (execution time < 5s for reasonable data)
```

---

## 🚀 Implementation Order

### Wave 1: Foundation (Settimana 1)
**Target:** 3 query semplici per validare pipeline

1. **0-NEWERA-PARTITECLIENTI-STEP0** — Very simple aggregation
2. **qSoloVend-step0** — Simple SELECT with GROUP BY
3. **CalcoloDisponibilita-step0** — Basic JOIN + aggregation

### Wave 2: Core (Settimana 2-3)
**Target:** 10 query medie per MVP feature

4. **qSoloVendItem-step1** — Medium complexity JOIN/GROUP
5. **def01-ANALISIVENDUTO-PIVOT-step0** — PIVOT conversion
6. **VenditeEPrenotazioni-step0** — UNION pattern
7. **AnalisiCredito-step0** — Complex aggregation
8-13. Altre query top priority

### Wave 3: Advanced (Settimana 4+)
**Target:** Remaining queries per completeness

14+. Query con dipendenze multiple, PIVOT, CTE

---

## ⚠️ Known Issues & Workarounds

### Issue: Stored Query Dependencies
**Problem:** Query A references query B in Access, non parametrizzabili
**Solution:**
- Merge queries inline (CTEs in T-SQL)
- OR crea separate Stored Procedures per ogni step
- Document dependency in comment

### Issue: DateDiff Parameter Order
**Problem:** Access `DateDiff('d', date1, date2)` vs SQL Server `DATEDIFF(DAY, date1, date2)`
**Solution:**
- Always double-check SQL Server docs
- Add comment: `-- SQL Server DATEDIFF: order is (unit, date1, date2)`

### Issue: NULL in Aggregates
**Problem:** `SUM([Amount])` in Access skips NULLs; SQL Server too (correct), but `ISNULL()` wrapping might be used in Access
**Solution:**
- Remove `ISNULL()` wrappers around aggregate functions
- Let SQL Server handle NULLs correctly

### Issue: Data Type Inference
**Problem:** Access infers types loosely; SQL Server strict
**Solution:**
- Always `CAST()` to explicit types
- Use consistent precision: `DECIMAL(18,4)` for money
- Use `INT` for quantities (not DECIMAL)

---

## 📝 Template SQL Header

```sql
-- ============================================================
-- QRY_NNN: [Nome Query]
-- ============================================================
-- Fonte originale: [Nome query Access]
-- Scopo business: [Descrizione breve in italiano]
--
-- Parametri:
--   @DateFrom   DATE  — Inizio periodo (era [Forms]![frmMain]![txtDataDa] se applicable)
--   @DateTo     DATE  — Fine periodo
--   @Company    NVARCHAR(5) — Company prefix (default: 'NEWERA')
--
-- Dipendenze query:
--   - QRY_NNN_step0: [descrizione]
--   - QRY_NNN_step1: [descrizione]
--
-- Modifiche da Jet SQL:
--   - #2023-01-01# → '2023-01-01'
--   - IIf(...) → CASE WHEN
--   - Val(...) → CAST(... AS DECIMAL)
--   - DateDiff parametri invertiti (Access: unit, date1, date2 → SQL: unit, date1, date2) [CHECK!]
--
-- Collaudo:
--   Eseguire e confrontare 10 righe di output con Access
--   Row count deve essere identico
--
-- Last modified: 2026-03-26
-- ============================================================

-- [Query SQL qui]
```

---

## 🔄 Iterative Process

1. **Convert 1 query** (classe 1, semplice)
2. **Test** in SQL Server
3. **Validate** vs Access output
4. **Document** learnings
5. **Iterate** con next query
6. **Automate** regex/patterns
7. **Scale** to 100+ queries

---

## 📞 Support Resources

- **SQL Server Docs:** https://learn.microsoft.com/en-us/sql/
- **Access SQL vs T-SQL comparison:** Google "Jet SQL to T-SQL conversion"
- **Online SQL formatter:** https://www.sql-format.com/
- **RegEx tester:** https://regex101.com/

---

**Next step:** Seleziona query classe 1 da convertire e iniziamo! 🚀
