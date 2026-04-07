# Excel Output Specification — Single Sheet

**Target:** One sheet "AnalisiVendite" with ~80-100 essential columns

---

## 📋 Column Selection Strategy

### Tier 1: MUST HAVE (30 columns)
**Order, Customer, Article, Sales Metrics, Margin**

```
1.  DocumentNo               (Document No_)
2.  LineNo                   (Line No_)
3.  OrderDate                (Order Date)
4.  SalesPersonCode          (Salesperson Code)
5.  SalesPersonName          (Salesperson)
6.  CustomerCode             (Sell-to Customer No_)
7.  CustomerName             (Customer Name)
8.  GeographicalZone         (Zone code)
9.  GeographicalZoneDesc     (Zone description)
10. ArticleCode              (Article)
11. Season                   (Season Code)
12. ColorCode                (Constant Variable Code)
13. ColorDesc                (Color description from Variable Code)
14. ItemDescription          (Description)
15. ItemDescription2         (Description 2)
16. Trademark                (Trademark Code)

--- QUANTITIES ---
17. QuantitySold
18. PairsSold
19. QuantityShipped
20. PairsShipped
21. QuantityInvoiced
22. PairsInvoiced

--- VALUES ---
23. ValueSold
24. ValueShipped
25. ValueInvoiced
26. LandedCost               (Cost per pair)
27. EstimatedLandedCostOnSold (PairsSold * LandedCost)
28. EstimatedMargin         (ValueSold - EstimatedLandedCostOnSold)
29. EstimatedCommissionTotal (Sum of 4 commission tiers)
30. EstimatedSecondMargin   (EstimatedMargin - EstimatedCommissionTotal)
```

### Tier 2: SHOULD HAVE (20 columns)
**Commission Detail, Status, Classification**

```
31. ProvvigioneAgente       (Commission rate %)
32. ProvvigioneCapozona
33. ProvvigioneSoggetto1
34. ProvvigioneSoggetto2
35. CommissionAgent€        (Calculated)
36. CommissionAreaMgr€      (Calculated)
37. CommissionSubj1€        (Calculated)
38. CommissionSubj2€        (Calculated)

--- STATUS ---
39. DeleteReason
40. DeleteDate
41. OrderType
42. DocumentType
43. Currency

--- CLASSIFICATION ---
44. VAT_Registration_No     (Customer VAT)
45. Vendor
46. Blocked
47. Anomalo                 (Flag)
48. NonAnomalo              (Flag)
49. AnomalousDate
50. StoreDistribution       (from Customer attributes)
```

### Tier 3: NICE TO HAVE (15-20 columns)
**Shipping, Risk, References**

```
51. ShipmentMethodCode
52. RequestedDeliveryDate
53. ShipToCode
54. ShipToName              (Bill-to Name)
55. ShipToCitySpedizione
56. ShipToPostalCode
57. ShipToCounty

--- ITEM ATTRIBUTES ---
58. ProductFamily
59. ProductTypology
60. ProductSex
61. MarketSegment
62. HeelHeight

--- CUSTOMER ATTRIBUTES ---
63. CustomerPostingGroup
64. CustomerLanguage
65. CustomerRisk            (Current Risk)
66. CustomerRiskRating
67. MustBuy                 (Flag)
```

**TOTAL: ~67 columns (vs 232)**

---

## 📊 Final Column Layout

| # | Column | Type | Example | Width |
|---|--------|------|---------|-------|
| **A** | DocumentNo | Text | OV-26/00272 | 15 |
| **B** | LineNo | Number | 10000 | 8 |
| **C** | OrderDate | Date | 19/01/26 | 12 |
| **D** | SalesPersonCode | Text | 1050 | 8 |
| **E** | SalesPersonName | Text | PIANO B SRL | 20 |
| **F** | CustomerCode | Text | C06995 | 12 |
| **G** | CustomerName | Text | EMME.E DI MICHELUTTO ELISABETTA | 35 |
| **H** | Zone | Text | 01 | 6 |
| **I** | ZoneDesc | Text | TRIVENETO | 15 |
| **J** | ArticleCode | Text | F6STAR01/LAM | 15 |
| **K** | Season | Text | I26 | 6 |
| **L** | ColorCode | Text | BEI | 6 |
| **M** | ColorDesc | Text | BEIGE | 12 |
| **N** | Description | Text | WOMAN SNEAKER | 20 |
| **O** | Trademark | Text | STD | 8 |
| **P** | QuantitySold | Number | 1 | 8 |
| **Q** | PairsSold | Number | 8 | 8 |
| **R** | ValueSold | Currency | 400,00 | 12 |
| **S** | QuantityShipped | Number | 0 | 8 |
| **T** | PairsShipped | Number | 0 | 8 |
| **U** | ValueShipped | Currency | 0,00 | 12 |
| **V** | QuantityInvoiced | Number | 0 | 8 |
| **W** | PairsInvoiced | Number | 0 | 8 |
| **X** | ValueInvoiced | Currency | 0,00 | 12 |
| **Y** | LandedCost | Currency | 22,96 | 10 |
| **Z** | EstLandedCost | Currency | 183,68 | 12 |
| **AA** | EstMargin | Currency | 216,32 | 12 |
| **AB** | CommRate1 | Number | 8 | 6 |
| **AC** | CommRate2 | Number | 0 | 6 |
| **AD** | CommRate3 | Number | 9 | 6 |
| **AE** | CommRate4 | Number | 1,85 | 6 |
| **AF** | Comm1€ | Currency | 32,00 | 10 |
| **AG** | Comm2€ | Currency | 0,00 | 10 |
| **AH** | Comm3€ | Currency | 36,00 | 10 |
| **AI** | Comm4€ | Currency | 7,40 | 10 |
| **AJ** | TotalComm€ | Currency | 75,40 | 10 |
| **AK** | SecondMargin | Currency | 140,92 | 12 |
| **AL** | DeleteReason | Text | (empty) | 15 |
| **AM** | DeleteDate | Date | (empty) | 12 |
| **AN** | OrderType | Text | Progr | 10 |
| **AO** | Currency | Text | EUR | 6 |
| **AP** | VAT_Number | Text | IT01907140931 | 15 |
| **AQ** | Vendor | Text | FUJIAN A.W | 20 |
| **AR** | Anomalo | Text | X | 6 |
| **AS** | Blocked | Number | 0 | 6 |
| **AT** | ShipMethod | Text | RDA | 10 |
| **AU** | DeliveryDate | Date | 10/08/26 | 12 |
| **AV** | ShipToCity | Text | PORDENONE | 15 |
| **AW** | ShipToPostal | Text | 33170 | 10 |
| ... | ... | ... | ... | ... |

**Total: ~67 columns**

---

## 🎨 Formatting

### Header Row
```
Background:     #003366 (Dark Blue)
Font:           White, Bold, 11pt, Centered
Borders:        All sides, 1pt Black
Height:         25pt
Freeze:         Row 1 (frozen panes)
AutoFilter:     Enable for all columns
```

### Data Rows
```
Font:           Black, 10pt, Calibri
Row Height:     18pt
Alternating:    Every other row: #F2F2F2 (Light Gray)
Borders:        Bottom border (1pt, light gray)

Currency:       Format: "€ #,##0.00" (European)
Date:           Format: "DD/MM/YYYY"
Number:         Format: "#,##0"
Percentage:     Format: "0.00%"
Decimal:        Format: "0.00"
```

### Column Widths
```
Text fields:    12-25 chars
Number fields:  8-10 chars
Currency fields: 12 chars
Date fields:    12 chars
```

---

## 📝 Example Output

```csv
DocumentNo|LineNo|OrderDate|SalesPersonCode|SalesPersonName|CustomerCode|CustomerName|Zone|ZoneDesc|ArticleCode|Season|ColorCode|ColorDesc|Description|Trademark|QuantitySold|PairsSold|ValueSold|QuantityShipped|PairsShipped|ValueShipped|QuantityInvoiced|PairsInvoiced|ValueInvoiced|LandedCost|EstLandedCost|EstMargin|CommRate1|CommRate2|CommRate3|CommRate4|Comm1€|Comm2€|Comm3€|Comm4€|TotalComm€|SecondMargin|DeleteReason|DeleteDate|OrderType|Currency|VAT_Number|Vendor|Anomalo|Blocked|...
OV-26/00272|10000|19/01/26|1050|PIANO B SRL|C06995|EMME.E DI MICHELUTTO ELISABETTA|01|TRIVENETO|F6STAR01/LAM|I26|BEI|BEIGE|WOMAN SNEAKER|STD|1|8|400.00|0|0|0.00|0|0|0.00|22.96|183.68|216.32|8|0|9|1.85|32.00|0.00|36.00|7.40|75.40|140.92||10/08/26|Progr|EUR|IT01907140931|FUJIAN A.W|X|0|...
```

---

## 🔧 SQL Mapping

Da quali campi SQL viene ogni colonna:

```sql
SELECT
  -- From qSoloVend-step1
  [Document No_],
  [Line No_],
  [Order Date],
  [Salesperson Code],
  Salesperson,
  [Sell-to Customer No_],
  CustomerName,
  [Geographical Zone],
  ColorCode,
  Article,
  [Season Code],

  -- From Item lookup
  Item.Description,
  Item.[Trademark Code],

  -- From Variable Code lookup
  [Variable Code].Description AS ColorDesc,

  -- From Geographical Zone lookup
  [Geographical Zone].Description AS ZoneDesc,

  -- Quantities & Values
  QuantitySold, PairsSold, ValueSold,
  QuantityShipped, PairsShipped, ValueShipped,
  QuantityInvoiced, PairsInvoiced, ValueInvoiced,

  -- Commissions (raw rates)
  ProvvigioneAgente, ProvvigioneCapozona,
  ProvvigioneSoggetto1, ProvvigioneSoggetto2,

  -- Lookup data
  Customer.[VAT Registration No_],
  Vendor.Name,
  Customer.[Blocked for Assignments],

  -- Status
  [Delete Reason], [Delete Date],
  OrderType, [Currency Code],

  -- Shipping
  ShipmentMethodCode,
  [Requested Delivery Date],
  ClienteSpedizione, CittaSpedizione,
  CodicePostaleSpedizione,

  -- Item attributes
  Item.[Product Family],
  Item.[Product Typology],
  Item.[Product Sex],
  Item.[Market Segment],
  Item.[Heel Height],

  -- Additional
  [Constant Variable Code],
  Anomalo, NonAnomalo,
  LandedCost.[landed Cost]

FROM qSoloVend-step1
INNER JOIN Item ON ...
LEFT JOIN Customer ON ...
LEFT JOIN Vendor ON ...
LEFT JOIN [Variable Code] ON ...
LEFT JOIN [Geographical Zone] ON ...
LEFT JOIN LandedCost ON ...
-- ... other lookups
```

---

## 📈 Backend Implementation

### 1. SQL: Select only 67 fields

```sql
CREATE OR ALTER FUNCTION dbo.udf_AnalisiVenditeExport(
  @DateFrom DATE,
  @DateTo DATE,
  @Seasons NVARCHAR(MAX) = NULL  -- comma-separated
)
RETURNS TABLE
AS RETURN
SELECT
  -- 67 essential fields only
  sh.[No_] AS DocumentNo,
  sl.[Line No_] AS LineNo,
  sh.[Order Date],
  sh.[Salesperson Code],
  sp.[Name] AS SalesPersonName,
  -- ... etc (only 67)
FROM NEWERA$[Sales Line] sl
INNER JOIN NEWERA$[Sales Header] sh ON ...
LEFT JOIN NEWERA$Item i ON ...
-- ... other joins
WHERE sh.[Order Date] BETWEEN @DateFrom AND @DateTo
  AND (ISNULL(@Seasons, '') = '' OR i.[Season Code] IN (SELECT value FROM STRING_SPLIT(@Seasons, ',')))
;
```

### 2. Backend: Calculate margins

```typescript
interface SalesRow {
  pairsSold: number;
  valueSold: number;
  landedCost: number | null;
  provvigioneAgente: number;
  provvigioneCapozona: number;
  provvigioneSoggetto1: number;
  provvigioneSoggetto2: number;
}

export function calculateMargins(rows: SalesRow[]) {
  return rows.map(row => ({
    ...row,
    estimatedLandedCostOnSold: (row.pairsSold * (row.landedCost || 0)),
    estimatedMargin: row.valueSold - (row.pairsSold * (row.landedCost || 0)),

    commissionAgent: (row.valueSold * row.provvigioneAgente) / 100,
    commissionAreaManager: (row.valueSold * row.provvigioneCapozona) / 100,
    commissionSubj1: (row.valueSold * row.provvigioneSoggetto1) / 100,
    commissionSubj2: (row.valueSold * row.provvigioneSoggetto2) / 100,
  }));
}
```

### 3. Excel Export

```typescript
import ExcelJS from 'exceljs';

export async function generateAnalisiVendite(rows: ProcessedRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('AnalisiVendite');

  // Add headers
  const columns = [
    { header: 'DocumentNo', key: 'documentNo', width: 15 },
    { header: 'LineNo', key: 'lineNo', width: 8 },
    { header: 'OrderDate', key: 'orderDate', width: 12 },
    // ... 64 more columns
  ];

  worksheet.columns = columns;

  // Format header row
  const headerRow = worksheet.getRow(1);
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003366' } };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  worksheet.freezePane = 'A2';
  worksheet.autoFilter.from = 'A1';
  worksheet.autoFilter.to = 'AK1'; // Adjust to last column

  // Add data rows
  let rowNum = 2;
  for (const row of rows) {
    const excelRow = worksheet.addRow({
      documentNo: row.documentNo,
      lineNo: row.lineNo,
      orderDate: row.orderDate,
      // ... map all 67 fields
    });

    // Format data row
    if (rowNum % 2 === 0) {
      excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    }

    // Format specific columns
    excelRow.getCell('C').numFmt = 'dd/mm/yy';  // Date
    excelRow.getCell('R').numFmt = '€ #,##0.00'; // Currency
    // ... etc for all currency columns

    rowNum++;
  }

  // Return as buffer
  return workbook.xlsx.writeBuffer();
}
```

### 4. tRPC Endpoint

```typescript
export const analysisRouter = router({
  exportVendite: publicProcedure
    .input(z.object({
      dateFrom: z.date(),
      dateTo: z.date(),
      seasons: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      // Query database
      const rows = await queryNav.udf_AnalisiVenditeExport(
        input.dateFrom,
        input.dateTo,
        input.seasons?.join(',')
      );

      // Calculate margins
      const enriched = calculateMargins(rows);

      // Generate Excel
      const buffer = await excelService.generateAnalisiVendite(enriched);

      return {
        buffer,
        filename: `AnalisiVendite_${format(input.dateTo, 'yyyy-MM-dd')}.xlsx`,
        rowCount: rows.length,
      };
    }),
});
```

---

## ✅ Checklist

- [x] Column selection: 67 essential fields
- [x] Formatting specification: Headers, data, currency
- [x] SQL mapping: Which fields from where
- [x] Backend calculation: Margins & commissions
- [x] Excel export: exceljs template
- [x] tRPC endpoint: Input validation, output
- [ ] Frontend button: "Export AnalisiVendite"
- [ ] Testing: Sample data export

---

## 🚀 Implementation Priority

**Week 1:** SQL + Backend + Excel (basic)
**Week 2:** Frontend button + filtering
**Week 3:** Formatting + polish

---

**Status:** 🟢 **SINGLE-SHEET SPEC READY**

Procediamo con SQL conversion? 🚀
