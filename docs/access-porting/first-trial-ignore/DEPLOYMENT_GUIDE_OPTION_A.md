# Option A — Detailed SQL Deployment Guide

**Obiettivo:** Deployare i 3 step della SQL pipeline al database NAV SQL Server

**Tempo stimato:** 30-60 minuti (incluse verifiche)

**Prerequisiti:**
- Accesso al server SQL Server NAV
- Microsoft SQL Server Management Studio (SSMS) o Azure Data Studio
- Credenziali con diritti di creazione funzioni (CREATE FUNCTION)
- Conoscenza del nome company NAV (es. NEWERA, LUKE, ecc.)

---

## ⚠️ PRE-DEPLOYMENT CHECKLIST

### 1. Verify NAV Database Connection

```bash
# Opzione 1: Command line (Windows)
sqlcmd -S <SERVER_NAME> -d <DATABASE_NAME> -U <USERNAME> -P <PASSWORD>

# Opzione 2: SQL Server Management Studio
# File → Connect to Server
# Server name: your-server-name
# Authentication: SQL Server Authentication
# Login: your-username
# Password: your-password
```

**Esempio per NEWERA NAV:**
```bash
sqlcmd -S navserver.local -d NEWERA -U sa -P YourPassword123
```

Se la connessione fallisce:
- ✓ Verifica il server name (ping navserver.local)
- ✓ Verifica il database name (SELECT name FROM sys.databases)
- ✓ Verifica le credenziali (ask admin)
- ✓ Verifica firewall (port 1433 aperto)

---

### 2. Verify NAV Table Names

Esegui questa query per verificare che le tabelle NAV esistono:

```sql
-- Verifica company name (es. NEWERA)
SELECT name FROM sys.tables WHERE name LIKE '%Sales Header%';
-- Expected: NEWERA$Sales Header

-- Verifica tutte le tabelle critiche
SELECT name FROM sys.tables
WHERE name IN (
  'NEWERA$Sales Header',
  'NEWERA$Sales Line',
  'NEWERA$Item',
  'NEWERA$Customer',
  'NEWERA$Vendor',
  'NEWERA$Variable Code',
  'NEWERA$Geographical Zone'
);
```

**Output atteso:**
```
NEWERA$Sales Header
NEWERA$Sales Line
NEWERA$Item
NEWERA$Customer
NEWERA$Vendor
NEWERA$Variable Code
NEWERA$Geographical Zone
```

Se manca qualche tabella:
- ❌ Contatta admin NAV (database incompleto?)
- ❌ Verifica il nome company (potrebbe essere diverso da NEWERA)

---

### 3. Verify Custom Tables Exist

Alcune tabelle sono custom in Luke (non standard NAV):

```sql
-- Verifica tabelle custom
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo'
AND TABLE_NAME IN (
  'DatiCarryOverESMU',
  'CommissionGroup',
  'LandedCost'
);
```

**Output atteso:**
```
DatiCarryOverESMU
CommissionGroup
LandedCost
```

Se tabelle mancano:
- ⚠️ CommissionGroup: Se non esiste, Step 3 avrà NULL per commission rates (non fatale)
- ⚠️ DatiCarryOverESMU: Se non esiste, Step 2 avrà NULL per carry-over (non fatale)
- ⚠️ LandedCost: Se non esiste, Step 2 avrà NULL per costi importazione (non fatale)

**Workaround:** Se tabelle custom mancano, possiamo crearle vuote per ora:
```sql
-- Create empty placeholder if needed
CREATE TABLE dbo.DatiCarryOverESMU (
  [Model Item No_] NVARCHAR(20),
  [Variable Code 01] NVARCHAR(20)
);

CREATE TABLE dbo.CommissionGroup (
  [Salesperson Code] NVARCHAR(20),
  [Season Code] NVARCHAR(10),
  [Commission Agent Rate] DECIMAL(18,2)
);

CREATE TABLE dbo.LandedCost (
  [No_] NVARCHAR(20),
  [Landed Cost] DECIMAL(18,2)
);
```

---

### 4. Verify NAV Table Structure

Prima di deployare, verifica che le colonne critiche esistono:

```sql
-- Check Sales Header columns
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'NEWERA$Sales Header'
AND COLUMN_NAME IN (
  'No_',
  'Order Date',
  'Sell-to Customer No_',
  'Salesperson Code',
  'Status',
  'Document Type',
  'Currency Code'
);
```

**Output atteso:**
```
No_                     | nvarchar
Order Date              | date (or datetime)
Sell-to Customer No_    | nvarchar
Salesperson Code        | nvarchar
Status                  | int (or tinyint)
Document Type           | int
Currency Code           | nvarchar
```

Se colonne hanno nomi diversi, aggiorna il codice SQL prima di deployare.

---

## 🚀 STEP 1: Deploy udf_SalesBase()

### 1A. Open SQL Editor

**In SQL Server Management Studio:**
1. File → New → Query
2. Seleziona il database (NEWERA)
3. Verifica in basso: "(1 row(s) affected)" dopo SELECT

**In Azure Data Studio:**
1. Click "New Query"
2. Select database: NEWERA

---

### 1B. Copy the SQL Function Code

Apri il file:
```
docs/access-porting/FASE_3_STEP_1_SQL_BASE.md
```

Scorri fino a "## 🔍 Implementazione T-SQL" e copia l'intero blocco SQL:

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesBase(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
-- ... (tutte le righe fino al ;)
```

---

### 1C. Paste into SQL Editor

In SSMS/Azure Data Studio, incolla il codice SQL completo.

**Verifica prima di eseguire:**
- ✓ Primo carattere è `CREATE OR ALTER`
- ✓ Ultimo carattere è `;`
- ✓ Nessun testo di commento markdown (solo `--` comments SQL)

---

### 1D. Execute the Function

Click **Execute** (F5) oppure:
```bash
# Via command line
sqlcmd -S <SERVER> -d NEWERA -U <USER> -P <PASS> -i udf_SalesBase.sql
```

**Risultato atteso:**
```
Command(s) completed successfully.
```

Se errore:
- ❌ **Syntax error**: Verifica che il codice SQL sia copiato completamente
- ❌ **Invalid column name**: Una colonna NAV non esiste (verifica Step 4 sopra)
- ❌ **Invalid object name**: Tabella NAV non trovata (verifica Step 2 sopra)

---

### 1E. Test udf_SalesBase()

Esegui questo test query:

```sql
-- Test 1: Basic execution
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT COUNT(*) AS RowCount
FROM dbo.udf_SalesBase('NEWERA', @From, @To);
```

**Risultato atteso:**
```
RowCount
--------
5234      (esempio: 5k-20k rows è normale)
```

Se ottieni 0 righe:
- ⚠️ Verifica che ci siano ordini nel date range (2024-01-01 to 2024-12-31)
- ⚠️ Prova date range più largo: ('2020-01-01', '2026-12-31')
- ⚠️ Verifica il formato della colonna Order Date (DATE vs DATETIME)

Se errore SQL:
- ❌ Table not found: Verifica @CompanyPrefix = 'NEWERA' è corretto
- ❌ Invalid column: Una colonna NAV ha nome diverso

---

### 1F. Validate Step 1 Data

Esegui questo query per controllare la qualità dei dati:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT TOP 5
  DocumentNo,
  LineNo,
  OrderDate,
  CustomerCode,
  ArticleCode,
  QuantitySold,
  ValueSold
FROM dbo.udf_SalesBase('NEWERA', @From, @To)
ORDER BY OrderDate DESC;
```

**Verifica:**
- ✓ DocumentNo non è NULL (es. "SO-26/00272")
- ✓ LineNo è numero (es. 10000, 20000)
- ✓ OrderDate è data (es. 2024-12-15)
- ✓ QuantitySold è numero (es. 8)
- ✓ ValueSold è importo (es. 400.00)

Se dati sembrano strani:
- Check ValueSold = QuantitySold × UnitPrice (ok? sì = buono)
- Check OrderDate è within @From/@To (ok? sì = buono)
- Check CustomerCode/ArticleCode sono non-NULL (ok? sì = buono)

---

### ✅ Step 1 Complete!

Quando il test passa e i dati sono OK, procedi a Step 2.

---

## 🚀 STEP 2: Deploy udf_SalesEnriched()

### 2A. Pre-Requisite Check

Verifica che Step 1 esista e funzioni:

```sql
-- Quick check that Step 1 exists
SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31');
-- Should return: 1 row with a number (5k-20k)
```

---

### 2B. Copy Step 2 SQL Code

Apri:
```
docs/access-porting/FASE_3_STEP_2_SQL_ENRICHED.md
```

Copia il blocco SQL da "## 🔍 Implementazione T-SQL":

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesEnriched(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
-- ... (tutto il codice)
```

---

### 2C. Paste and Execute

Incolla in una nuova query window:

```bash
# Via SSMS: File → New Query → Paste → F5

# Via command line:
sqlcmd -S <SERVER> -d NEWERA -U <USER> -i udf_SalesEnriched.sql
```

**Risultato atteso:**
```
Command(s) completed successfully.
```

Se errore:
- ❌ **Cannot find function udf_SalesBase**: Step 1 non è deployato correttamente
- ❌ **Invalid column**: Una colonna Item/Customer/Zone non esiste
- ❌ **Syntax error**: Codice copiato incompleto

---

### 2D. Test Row Count Consistency

Verifica che Step 2 ritorna lo stesso numero di righe di Step 1:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  (SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', @From, @To)) AS BaseCount,
  (SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)) AS EnrichedCount;
```

**Risultato atteso:**
```
BaseCount | EnrichedCount
----------|---------------
5234      | 5234
```

Se numeri sono diversi:
- ⚠️ Se EnrichedCount > BaseCount: Ok, significa che qualche JOIN ha fatto LEFT JOINs che aggiungono righe (non dovrebbe capitare per il nostro design)
- ⚠️ Se EnrichedCount < BaseCount: **Data loss!** Una JOIN ha escluso righe
  - Verifica se Item INNER JOIN è il problema
  - Controlla se articoli hanno IDs invalidi

---

### 2E. Inspect Item Lookup Coverage

Verifica che i lookups funzionano correttamente:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  COUNT(*) AS TotalRows,
  COUNT(CASE WHEN ItemDescription IS NOT NULL THEN 1 END) AS WithItemDesc,
  COUNT(CASE WHEN ColorDescription IS NOT NULL THEN 1 END) AS WithColorDesc,
  COUNT(CASE WHEN SupplierName IS NOT NULL THEN 1 END) AS WithSupplier,
  COUNT(CASE WHEN CostImportation > 0 THEN 1 END) AS WithLandedCost
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To);
```

**Risultato atteso:**
```
TotalRows | WithItemDesc | WithColorDesc | WithSupplier | WithLandedCost
----------|--------------|---------------|--------------|----------------
5234      | 5234         | 4871          | 4956         | 3824
```

Se risultati sono strani:
- ✓ ItemDescription = TotalRows: Buono (Item INNER JOIN funziona)
- ✓ ColorDescription ~90-95%: Buono (alcuni items non hanno color codes)
- ✓ SupplierName ~90-95%: Buono (alcuni items non hanno supplier)
- ✓ WithLandedCost ~70-80%: Buono (molti items non hanno landed cost)

Se tutti sono 0 (tranne TotalRows):
- ❌ JOINs non funzionano (verifica nome tabelle)
- ❌ Colonne non trovate (verifica spelling)

---

### 2F. Sample Data Check

Guarda alcuni dati reali:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT TOP 3
  DocumentNo,
  OrderDate,
  ArticleCode,
  ItemDescription,
  ColorCode,
  ColorDescription,
  SupplierName,
  CostImportation
FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)
WHERE ItemDescription IS NOT NULL
ORDER BY OrderDate DESC;
```

**Verifica:**
- ✓ ItemDescription populated (es. "WOMAN SNEAKER")
- ✓ ColorDescription populated se ColorCode non è NULL (es. "BEIGE")
- ✓ SupplierName populated se Supplier Code non è NULL
- ✓ CostImportation è 0 o numero (es. 22.96)

---

### ✅ Step 2 Complete!

Quando il test di consistenza passa, procedi a Step 3.

---

## 🚀 STEP 3: Deploy udf_SalesFinal()

### 3A. Pre-Requisite Check

Verifica che Step 1 e 2 esistono:

```sql
SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', '2024-01-01', '2024-12-31');
SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', '2024-01-01', '2024-12-31');
-- Entrambi dovrebbero ritornare numeri >0
```

---

### 3B. Copy Step 3 SQL Code

Apri:
```
docs/access-porting/FASE_3_STEP_3_SQL_FINAL.md
```

Copia da "## 🔍 Implementazione T-SQL":

```sql
CREATE OR ALTER FUNCTION dbo.udf_SalesFinal(
  @CompanyPrefix NVARCHAR(5) = 'NEWERA',
  @DateFrom DATE,
  @DateTo DATE
)
RETURNS TABLE AS RETURN
-- ... (tutto)
```

---

### 3C. Paste and Execute

```bash
# SSMS: File → New Query → Paste → F5

# Command line:
sqlcmd -S <SERVER> -d NEWERA -U <USER> -i udf_SalesFinal.sql
```

**Risultato atteso:**
```
Command(s) completed successfully.
```

Se errore:
- ❌ **Invalid column**: Tabella Payment Terms o Shipment Method non esiste in NAV
  - **Workaround**: Se tabelle non esistono, rimuovi quelle JOINs da Step 3
- ❌ **Cannot find function**: Step 2 non è deployato
- ❌ **Syntax error**: Codice incompleto

---

### 3D. Test Complete Pipeline

Verifica che tutti 3 step ritornano lo stesso numero di righe:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  (SELECT COUNT(*) FROM dbo.udf_SalesBase('NEWERA', @From, @To)) AS Step1,
  (SELECT COUNT(*) FROM dbo.udf_SalesEnriched('NEWERA', @From, @To)) AS Step2,
  (SELECT COUNT(*) FROM dbo.udf_SalesFinal('NEWERA', @From, @To)) AS Step3;
```

**Risultato atteso:**
```
Step1 | Step2 | Step3
------|-------|-------
5234  | 5234  | 5234
```

Se Step3 < Step2:
- ⚠️ Una JOIN in Step 3 sta perdendo dati
- ⚠️ Potrebbe essere Payment Terms o Shipment Method JOINs
- **Fix**: Cambia JOIN in LEFT JOIN (dovrebbero già essere LEFT)

---

### 3E. Test Commission Rates

Verifica che commission rates sono presenti:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  COUNT(*) AS TotalRows,
  COUNT(CASE WHEN CommissionAgentRate > 0 THEN 1 END) AS WithAgentRate,
  AVG(CommissionAgentRate) AS AvgAgentRate,
  MAX(CommissionAgentRate) AS MaxAgentRate
FROM dbo.udf_SalesFinal('NEWERA', @From, @To);
```

**Risultato atteso:**
```
TotalRows | WithAgentRate | AvgAgentRate | MaxAgentRate
----------|---------------|--------------|---------------
5234      | 3456          | 8.5          | 15.2
```

Se tutti CommissionAgentRate sono 0 o NULL:
- ⚠️ CommissionGroup table non ha dati
- ⚠️ Salesperson Code non matcha tra Sales Header e CommissionGroup
- **Non fatale**: Backend userà 0% rate per calcoli

---

### 3F. Test Anomaly Detection

Verifica anomaly detection flags:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT
  COUNT(*) AS TotalRows,
  COUNT(CASE WHEN HasAnomaly = 1 THEN 1 END) AS AnomalousRows,
  ROUND(100.0 * COUNT(CASE WHEN HasAnomaly = 1 THEN 1 END) / COUNT(*), 2) AS AnomalyPercent
FROM dbo.udf_SalesFinal('NEWERA', @From, @To);
```

**Risultato atteso:**
```
TotalRows | AnomalousRows | AnomalyPercent
----------|---------------|----------------
5234      | 312           | 5.97
```

Se AnomalyPercent > 20%:
- ⚠️ Molte righe hanno quantity=0 oppure value=0
- ⚠️ Potrebbe essere normale (orders cancelled, ecc.)
- Check questi dettagli:

```sql
SELECT TOP 10
  DocumentNo,
  QuantitySold,
  ValueSold,
  CostImportation,
  HasAnomaly,
  CASE
    WHEN ValueSold = 0 AND QuantitySold > 0 THEN 'Qty but no value'
    WHEN ValueSold > 0 AND QuantitySold = 0 THEN 'Value but no qty'
    WHEN CostImportation > ValueSold THEN 'Cost > Value'
    ELSE 'Unknown'
  END AS AnomalyReason
FROM dbo.udf_SalesFinal('NEWERA', @From, @To)
WHERE HasAnomaly = 1
ORDER BY OrderDate DESC;
```

---

### 3G. Sample Final Data

Guarda il risultato finale:

```sql
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT TOP 1
  DocumentNo,
  OrderDate,
  CustomerCode,
  ArticleCode,
  QuantitySold,
  ValueSold,
  CommissionAgentRate,
  CommissionAreaManagerRate,
  CostImportation,
  HasAnomaly,
  IsDeleted,
  ExportTimestamp
FROM dbo.udf_SalesFinal('NEWERA', @From, @To)
ORDER BY OrderDate DESC;
```

**Verifica:**
- ✓ Tutte le colonne hanno dati (o NULL dove atteso)
- ✓ CommissionAgentRate > 0 (oppure 0 se non configurato)
- ✓ ExportTimestamp è populated (GETDATE() al momento dell'esecuzione)
- ✓ HasAnomaly è 0 o 1 (flag)

---

### ✅ Step 3 Complete!

---

## 📊 FINAL VALIDATION: Performance Test

Esegui questo per verificare performance:

```sql
-- Test query complexity
DECLARE @StartTime DATETIME2 = GETDATE();
DECLARE @From DATE = '2024-01-01';
DECLARE @To DATE = '2024-12-31';

SELECT COUNT(*) AS RowCount
FROM dbo.udf_SalesFinal('NEWERA', @From, @To);

DECLARE @EndTime DATETIME2 = GETDATE();
PRINT CONCAT('Execution time: ', DATEDIFF(MILLISECOND, @StartTime, @EndTime), 'ms');
```

**Risultato atteso:**
```
RowCount
--------
5234

Execution time: 347ms
```

**Benchmark:**
- ✓ **200-500ms**: Excellent
- ✓ **500-1000ms**: Good
- ⚠️ **1000-2000ms**: Acceptable (consider indexes)
- ❌ **>2000ms**: Slow (add indexes)

Se troppo lento:
```sql
-- Add indexes
CREATE NONCLUSTERED INDEX idx_SalesHeader_OrderDate
ON [NEWERA$Sales Header]([Order Date])
INCLUDE ([No_], [Sell-to Customer No_], [Salesperson Code]);

CREATE NONCLUSTERED INDEX idx_SalesLine_DocumentNo
ON [NEWERA$Sales Line]([Document No_]);

CREATE CLUSTERED INDEX pk_Item
ON [NEWERA$Item]([No_]);
```

---

## ✅ DEPLOYMENT COMPLETE!

Quando tutti i 3 step sono deployati e testati:

### Checklist Finale

- [ ] Step 1 deployed: `dbo.udf_SalesBase()` ✓
- [ ] Step 1 ritorna righe: COUNT(*) > 0 ✓
- [ ] Step 2 deployed: `dbo.udf_SalesEnriched()` ✓
- [ ] Step 2 row count = Step 1 ✓
- [ ] Step 3 deployed: `dbo.udf_SalesFinal()` ✓
- [ ] Step 3 row count = Step 2 ✓
- [ ] Commission rates populated ✓
- [ ] Performance acceptable (<1s) ✓
- [ ] Sample data looks correct ✓

### Prossimi Passi

Ora puoi:
1. ✅ **Backend integration** — Create TypeScript service che chiama udf_SalesFinal()
2. ✅ **Margin calculations** — Backend calcola margins con type-safe Decimals
3. ✅ **Excel export** — exceljs genera file con 232 colonne
4. ✅ **Frontend dashboard** — tRPC endpoint + UI per l'export

---

## 🆘 Troubleshooting

### Error: "Invalid object name 'NEWERA$Sales Header'"

```sql
-- Verifica il nome della company
SELECT TOP 1 name FROM sys.tables WHERE name LIKE '%Sales Header%';
-- Output: [NEWERA$Sales Header]

-- Se output è diverso, aggiorna @CompanyPrefix
-- Esempio: se è [LUKE$Sales Header], usa @CompanyPrefix = 'LUKE'
```

### Error: "The multi-part identifier "..." could not be bound"

```sql
-- Significa una colonna non esiste in quella tabella
-- Verifica il nome colonna esatto:
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'NEWERA$Sales Header'
ORDER BY COLUMN_NAME;
```

### Error: "Timeout expired"

```sql
-- Query è troppo lenta, aggiungi indici:
CREATE NONCLUSTERED INDEX idx_SalesHeader_OrderDate
ON [NEWERA$Sales Header]([Order Date])
INCLUDE ([No_], [Sell-to Customer No_], [Salesperson Code]);
```

### Function works but returns 0 rows

```sql
-- Check se date range è corretto
SELECT MIN([Order Date]), MAX([Order Date])
FROM [NEWERA$Sales Header];

-- Se range è 2020-2024 e query cerca 2024, aumenta range:
SELECT COUNT(*) FROM dbo.udf_SalesFinal('NEWERA', '2020-01-01', '2026-12-31');
```

---

**Status:** 🟢 **DEPLOYMENT GUIDE COMPLETE**

Sei pronto a deployare! Dimmi se hai domande su uno specifico step.
