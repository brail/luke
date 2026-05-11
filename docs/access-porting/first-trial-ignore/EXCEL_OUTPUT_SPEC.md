# Excel Output Specification — "AnalisiVendite.xlsx"

**Versione:** 1.0
**Data:** 2026-03-27
**Status:** Specification for Luke porting

---

## 📊 Problema Attuale

File `output.xlsx` contiene:
```
Row 1 (Headers):  0    | 1    | 2    | 3    | ... | 231  (numeri, non descrittivi!)
Row 2 (Data):     232  | 233  | 234  | 235  | ... | 2    (valori raw)
```

**Impatto:** Incomprensibile per utenti finali

---

## 🎯 Soluzione: Excel con Nomi Descrittivi + Multiple Sheets

### Struttura Proposta

```
AnalisiVendite.xlsx
├── Sheet 1: "Vendite Dettaglio"      ← Main report (sortable, filterable)
├── Sheet 2: "Analisi Margini"        ← Margin analysis (with formulas)
├── Sheet 3: "Dati Cliente"           ← Customer lookup (reference)
└── Sheet 4: "Parametri Filtro"       ← Filter info (metadata)
```

---

## 📋 SHEET 1: "Vendite Dettaglio" (Main Report)

### Column Mapping (priorità: essenziale → utile → opzionale)

| Col # | Access Field | Excel Header | Type | Format | Essenziale |
|-------|--------------|--------------|------|--------|-----------|
| 1 | Document No_ | DocumentNo | Text | SO-2024-001 | ✅ |
| 2 | Line No_ | LineNo | Number | 10000 | ✅ |
| 3 | Order Date | OrderDate | Date | 2024-03-15 | ✅ |
| 4 | Salesperson Code | SalesPersonCode | Text | SP-001 | ✅ |
| 5 | Salesperson | SalesPersonName | Text | Mario Rossi | ✅ |
| 6 | Sell-to Customer No_ | CustomerCode | Text | CUST-001 | ✅ |
| 7 | Customer Name | CustomerName | Text | Acme Ltd | ✅ |
| 8 | Geographical Zone | SalesZone | Text | NORTH | ✅ |
| 9 | Article | ArticleCode | Text | ART-001 | ✅ |
| 10 | Season Code | Season | Text | S24 | ✅ |
| 11 | Model Item No_ | ModelItem | Text | MODEL-001 | ✅ |
| 12 | Color Code | ColorCode | Text | RED | ✅ |
| 13 | Color Desc | ColorName | Text | Rosso | ✅ |
| 14 | Quantity Sold | QuantitySold | Number | 100 | ✅ |
| 15 | Pairs Sold | PairsSold | Number | 50 | ✅ |
| 16 | Value Sold | ValueSold | Currency | 5,000.00 | ✅ |
| 17 | Quantity Shipped | QuantityShipped | Number | 80 | 🟠 |
| 18 | Pairs Shipped | PairsShipped | Number | 40 | 🟠 |
| 19 | Value Shipped | ValueShipped | Currency | 4,000.00 | 🟠 |
| 20 | Quantity Invoiced | QuantityInvoiced | Number | 60 | 🟠 |
| 21 | Pairs Invoiced | PairsInvoiced | Number | 30 | 🟠 |
| 22 | Value Invoiced | ValueInvoiced | Currency | 3,000.00 | 🟠 |
| 23 | Delete Date | DeleteDate | Date | [null] | 🟡 |
| 24 | Delete Reason | DeleteReason | Text | [null] | 🟡 |
| 25 | Currency Code | Currency | Text | EUR | 🟡 |
| 26 | Order Type | OrderType | Text | ORDER | 🟡 |
| ... | ... | ... | ... | ... | ... |

**Total Columns (Sheet 1):** ~50 campi (ridotto da 232)

### Example Row

```
DocumentNo | LineNo | OrderDate  | SalesPersonCode | SalesPersonName | CustomerCode | CustomerName | SalesZone | ArticleCode | Season | ColorCode | ColorName | QuantitySold | PairsSold | ValueSold
-----------|--------|------------|-----------------|-----------------|--------------|--------------|-----------|-------------|--------|-----------|-----------|--------------|-----------|----------
SO-2024-01 | 10000  | 2024-03-15 | SP-001          | Mario Rossi     | CUST-001     | Acme Ltd     | NORTH     | ART-001     | S24    | RED       | Rosso     | 100          | 50        | 5000.00
SO-2024-01 | 20000  | 2024-03-15 | SP-001          | Mario Rossi     | CUST-002     | Beta Corp    | NORTH     | ART-002     | S24    | BLUE      | Blu       | 75           | 37        | 3750.00
```

### Formatting

```
Header Row:
  - Background: Dark Blue (#003366)
  - Font: White, Bold, 11pt
  - Frozen (ctrl+F)

Data Rows:
  - Alternating colors: White / Light Gray (#F2F2F2)
  - Currency: Format as "€ #,##0.00" (European)
  - Date: Format as "DD/MM/YYYY"
  - Number: Format as "#,##0" (thousands separator)

Filters:
  - AutoFilter enabled on header row
  - User can filter by any column

Width:
  - Auto-fit columns
  - Min width: 10 chars
  - Max width: 40 chars
```

---

## 📊 SHEET 2: "Analisi Margini" (Margin Analysis)

**Purpose:** High-level analysis with calculated fields

### Structure

| Column | Source | Type | Note |
|--------|--------|------|------|
| **Grouping** | | | |
| Season | qSoloVend | Text | |
| SalesPersonCode | qSoloVend | Text | |
| SalesPersonName | qSoloVend | Text | |
| **Metrics** | | | |
| TotalQuantitySold | SUM | Number | |
| TotalPairsSold | SUM | Number | |
| TotalValueSold | SUM | Currency | Raw sales value |
| TotalLandedCost | CALC | Currency | Sum(pairs * cost) |
| TotalMargin | CALC | Currency | ValueSold - LandedCost |
| TotalCommissions | CALC | Currency | Sum of all 4 commission tiers |
| SecondMargin | CALC | Currency | Margin after commissions |
| MarginPercentage | CALC | Percentage | (SecondMargin / ValueSold) * 100 |
| **Commission Breakdown** | | | |
| CommissionAgent | CALC | Currency | ValueSold * rate_agent / 100 |
| CommissionAreaManager | CALC | Currency | ValueSold * rate_area_manager / 100 |
| CommissionSubject1 | CALC | Currency | ValueSold * rate_subject1 / 100 |
| CommissionSubject2 | CALC | Currency | ValueSold * rate_subject2 / 100 |

### Example

```
Season | SalesPersonCode | SalesPersonName | TotalValueSold | TotalLandedCost | TotalMargin | TotalCommissions | SecondMargin | MarginPercentage
-------|-----------------|-----------------|----------------|-----------------|-------------|------------------|--------------|------------------
S24    | SP-001          | Mario Rossi     | 50,000.00      | 15,000.00       | 35,000.00   | 5,250.00         | 29,750.00    | 59.5%
S24    | SP-002          | Anna Bianchi    | 35,000.00      | 10,500.00       | 24,500.00   | 3,675.00         | 20,825.00    | 59.5%
```

---

## 📋 SHEET 3: "Dati Cliente" (Customer Lookup Reference)

**Purpose:** Detailed customer info (hidden by default, shown on demand)

### Structure

| Column | Type | Note |
|--------|------|------|
| CustomerCode | Text | |
| CustomerName | Text | |
| VAT Number | Text | |
| Country | Text | |
| City | Text | |
| Address | Text | |
| Phone | Text | |
| Email | Text | |
| CreditLimit | Currency | |
| CurrentRisk | Text | HIGH / MEDIUM / LOW |
| Blocked | Boolean | |

**Usage:** VLOOKUP from Sheet1 if user clicks on CustomerCode

---

## 📋 SHEET 4: "Parametri Filtro" (Metadata)

**Purpose:** Store filter values used to generate this report

### Structure

```
Parameter          | Value
-------------------|------------------
ReportDate         | 2024-03-27
FilterSeason       | S24
FilterCustomer     | (all)
FilterSalesperson  | SP-001
DateFrom           | 2024-01-01
DateTo             | 2024-03-31
RowsReturned       | 1,245
GeneratedBy        | Luke AnalysisAPI/1.0
```

**Usage:**
- Document how the report was generated
- Allow "refresh" button (re-run with same filters)
- Help with audit trail

---

## 🔧 Technical Implementation

### Technology: exceljs (Node.js)

```typescript
import ExcelJS from 'exceljs';

interface AnalysisExportRequest {
  dateFrom: Date;
  dateTo: Date;
  filters: {
    seasons?: string[];
    customers?: string[];
    salespersons?: string[];
  };
}

export async function generateAnalisiVenditeExcel(
  request: AnalysisExportRequest
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Vendite Dettaglio
  const sheet1 = workbook.addWorksheet('Vendite Dettaglio');
  await populateVenditeSheet(sheet1, request);

  // Sheet 2: Analisi Margini
  const sheet2 = workbook.addWorksheet('Analisi Margini');
  await populateMarginiSheet(sheet2, request);

  // Sheet 3: Dati Cliente
  const sheet3 = workbook.addWorksheet('Dati Cliente');
  await populateClientiSheet(sheet3);

  // Sheet 4: Parametri
  const sheet4 = workbook.addWorksheet('Parametri Filtro');
  await populateParametriSheet(sheet4, request);

  // Return as buffer
  return workbook.xlsx.writeBuffer();
}
```

### Flow in Luke

```
tRPC Endpoint: /api/analysis/export

Input:
  - dateFrom: Date
  - dateTo: Date
  - filters: SalesFinalFilters

Process:
  1. Query udf_SalesFinal() with filters
  2. calculateMargins() for all rows
  3. Group by season/salesperson for Sheet 2
  4. Build Excel workbook (exceljs)
  5. Return as attachment

Output:
  - Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  - Content-Disposition: attachment; filename=AnalisiVendite_20240327.xlsx
  - Body: Excel file buffer
```

---

## 📊 Column Count Reduction

| Current (Access) | Proposed (Luke) | Reduction |
|-----------------|-----------------|-----------|
| 232 columns | 50 (Sheet 1) | -78% |
| All in 1 sheet | 4 sheets organized | Better UX |
| No formatting | Colored headers, formatting | Professional |
| Raw numbers | Descriptive names | Usable |

---

## ✅ Checklist per Implementazione

Sheet 1: "Vendite Dettaglio"
- [ ] Define 50 essential columns (vs 232)
- [ ] Add descriptive header names
- [ ] Format: currency, date, numbers
- [ ] Add AutoFilter to headers
- [ ] Freeze header row
- [ ] Add alternating row colors

Sheet 2: "Analisi Margini"
- [ ] GROUP BY season + salesperson
- [ ] SUM quantities, values
- [ ] CALC: margin = valueSold - (pairsSold * cost)
- [ ] CALC: commissions per tier
- [ ] CALC: secondMargin = margin - commissions
- [ ] Format: currency, percentage
- [ ] Add summary row (GRAND TOTAL)

Sheet 3: "Dati Cliente"
- [ ] Fetch all customers referenced in Sheet1
- [ ] Add lookup data
- [ ] Hide by default (user can unhide)

Sheet 4: "Parametri Filtro"
- [ ] Document filter values used
- [ ] Store date range
- [ ] Count rows returned
- [ ] API version / generation timestamp

---

## 🚀 Implementation Priority

### MVP (Week 1)
- ✅ Sheet 1: Vendite Dettaglio (50 columns, no formatting)
- ✅ Basic column names
- ✅ Export as `.xlsx`

### Phase 2 (Week 2)
- ✅ Column formatting (currency, date, numbers)
- ✅ AutoFilter + frozen headers
- ✅ Sheet 2: Analisi Margini (summary + analysis)

### Phase 3 (Week 3)
- ✅ Sheet 3: Dati Cliente (lookup reference)
- ✅ Sheet 4: Parametri Filtro (metadata)
- ✅ Color schemes + polish

---

## 📝 Notes

**Why 50 columns (Sheet 1) instead of 232?**
- 70% delle colonne sono raramente usate (WMS details, legacy fields)
- Sheet 1: essenziali per reporting quotidiano
- Sheet 2: analisi margini (calculated)
- Sheet 3-4: dettagli on-demand

**Why multiple sheets?**
- Readability (users don't scroll 232 columns!)
- Performance (smaller datasets per sheet)
- Flexibility (can be created/modified separately)
- Professional (organized, not overwhelming)

**How to handle the 232 columns?**
- Option A: Keep as hidden columns in Sheet 1 (for backward compat)
- Option B: Store in database for advanced export (raw data)
- Option C: Make downloadable via API (separate endpoint)

**Recommendation:** Start with 50-column MVP (Sheet 1 only), add others as needed.

---

**Status:** 🟢 **SPECIFICATION READY FOR DEVELOPMENT**
