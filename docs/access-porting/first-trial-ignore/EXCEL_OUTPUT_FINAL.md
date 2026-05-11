# Excel Output Final Specification

**Base:** output.csv analysis - 232 fields categorized
**Estratto da:** def01-ANALISIVENDUTO-PIVOT-step0 query

---

## 📊 Field Categories (232 fields)

| Categoria | Qty | Essenziale | Uso |
|-----------|-----|-----------|-----|
| **Document/Order** | 21 | ✅ | Order identification, billing |
| **Customer** | 21 | ✅ | Customer info, classification |
| **Article/Item** | 6 | ✅ | Product identification |
| **Quantities** | 24 | ✅ | Sales qty, shipped qty, invoice qty, WMS states |
| **Values/Money** | 28 | ✅ | Raw amounts + calculated (margin, commissions) |
| **Shipping/WMS** | 9 | 🟠 | Shipment address, delivery date, agents |
| **Commissions** | 6 | ✅ | Commission rates (4 tiers) |
| **Item Attributes** | 11 | 🟡 | Store type, distribution, materials (mostly empty in sample) |
| **Risk/Credit** | 13 | 🟡 | Anomaly flags, customer risk evaluation |
| **Geographical** | 11 | ✅ | Sales zone, ship-to zone, country |
| **Dates** | 6 | 🟡 | Order date, delete date, cutoff dates |
| **Flags/Status** | 1 | 🟡 | Order status |
| **Other** | 75 | 🟡 | Discount codes, special requests, agents, etc. |

---

## 🎯 Proposed Excel Structure

### Option 1: Single Sheet (Simplified)

**Sheet 1: "Analisi Vendite"** — 60-80 essential columns only

```
Document/Order (8):
  DocumentNo | LineNo | OrderDate | OrderType | Status | BudgetNo | CurrencyCode | Key Account

Customer (6):
  CustomerCode | CustomerName | SalesPersonCode | SalesPersonName |
  GeographicalZone | CustomerPostingGroup

Article (5):
  ArticleCode | Season | ConstantVariableCode (Color) | Description | Trademark

Quantities (8):
  QuantitySold | PairsSold |
  QuantityShipped | PairsShipped |
  QuantityInvoiced | PairsInvoiced |
  QuantityReadyForShipping | PairsReadyForShipping

Values (8):
  ValueSold | ValueShipped | ValueInvoiced | ValueReadyForShipping |
  EstimatedLandedCost | EstimatedMargin |
  EstimatedCommissionTotal | EstimatedSecondMargin

Commissions (4):
  ProvvigioneAgente | ProvvigioneCapozona | ProvvigioneSoggetto1 | ProvvigioneSoggetto2

Other Key (8):
  ColorDescription | DeleteDate | DeleteReason |
  ShipmentMethodCode | RequestedDeliveryDate |
  VAT_Registration_No | Vendor | Anomalo/NonAnomalo
```

**Total: ~60 columns** (vs 232)

### Option 2: Multi-Sheet (Recommended for Luke)

#### Sheet 1: "Vendite Dettaglio" (Main Report)

**40 core columns:**
- Document/Order (7 cols)
- Customer (6 cols)
- Article (5 cols)
- Quantities base (6 cols): QuantitySold, PairsSold, QuantityShipped, PairsShipped, QuantityInvoiced, PairsInvoiced
- Values base (6 cols): ValueSold, ValueShipped, ValueInvoiced, EstimatedMargin, Commission totals, SecondMargin
- Key attributes (4 cols): Season, ColorCode, GeographicalZone, OrderDate
- Other (6 cols): SalesPersonCode, Anomalo flag, DeleteDate, VAT Number, Vendor, Blocked

**Features:**
```
Header:
  - Background: Blue, White text, Bold, 11pt
  - Frozen (row 1)
  - AutoFilter enabled

Data:
  - Currency: Format as "€ #,##0.00"
  - Date: Format as "DD/MM/YYYY"
  - Numbers: "#,##0"
  - Alternating row colors: White / Light Gray
```

#### Sheet 2: "Analisi WMS" (Shipping States Detail)

**WMS Quantity/Value breakdown:**
```
DocumentNo | LineNo | ColorCode |
QuantityReadyForShippingTotale | PairsReadyForShippingTotale | ValueReadyForShippingTotale |
QuantityReadyForShippingRilasciate | PairsReadyForShippingRilasciate | ValueReadyForShippingRilasciate |
QuantityReadyForShippingAperte | PairsReadyForShippingAperte | ValueReadyForShippingAperte |
QuantityReadyForShippingDaInviareWMSps | QuantityReadyForShippingInviatoWMSps | QuantityReadyForShippingEvasoWMSps
```

#### Sheet 3: "Margini & Commissioni" (Calculated Analysis)

**Aggregated by SalesPersonCode + Season:**
```
Season | SalesPersonCode | SalesPersonName |
TotalQuantitySold | TotalPairsSold | TotalValueSold |
TotalLandedCostOnSold | TotalMargin |
CommissionAgent | CommissionAreaManager | CommissionSubject1 | CommissionSubject2 |
SecondMargin | MarginPercentage
```

#### Sheet 4: "Dati Articoli" (Item Lookup)

**Item master data (referenced from Sheet 1):**
```
ArticleCode | Description | Description2 | Season | Trademark | Line | Collection |
Product Family | Product Typology | Product Sex | Material | SoleMaterial |
Heel Height | Market Segment | Vendor | ManufacturerName | Origin Country |
StoreDistribution | StoreImage | StoreType | MustBuy
```

#### Sheet 5: "Metadati" (Filter Info & Audit)

```
Report Title         | AnalisiVendite
Generated Date       | 2026-03-27
Generated Time       | 10:30:45
Filter Season        | (values or "All")
Filter Customer      | (values or "All")
Filter Salesperson   | (values or "All")
Date From           | 2026-01-01
Date To             | 2026-03-27
Rows Returned       | 1,245
Data Source         | udf_SalesFinal (Luke)
API Version         | 1.0
```

---

## 🔧 Mapping: CSV Fields → Excel Sheets

### Sheet 1: Vendite Dettaglio (Primary Report)

| Excel Col | CSV Field | Type | Format |
|-----------|-----------|------|--------|
| A | Document No_ | Text | SO-26/00272 |
| B | Line No_ | Number | 10000 |
| C | Order Date | Date | 19/01/26 |
| D | Salesperson Code | Text | 1050 |
| E | Salesperson | Text | PIANO B SRL |
| F | Customer Code | Text | C06995 |
| G | Customer Name | Text | EMME.E DI MICHELUTTO ELISABETTA |
| H | Season Code | Text | I26 |
| I | Article | Text | F6STAR01/LAM |
| J | Color Code | Text | BEI |
| K | Color Description | Text | BEIGE |
| L | Quantity Sold | Number | 1 |
| M | Pairs Sold | Number | 8 |
| N | Value Sold | Currency | 400,00 |
| O | Quantity Shipped | Number | 0 |
| P | Pairs Shipped | Number | 0 |
| Q | Value Shipped | Currency | 0,00 |
| R | Quantity Invoiced | Number | 0 |
| S | Pairs Invoiced | Number | 0 |
| T | Value Invoiced | Currency | 0,00 |
| U | Quantity Ready Total | Number | 0 |
| V | Pairs Ready Total | Number | 0 |
| W | Value Ready Total | Currency | 0,00 |
| X | Landed Cost (per pair) | Currency | 22,96 |
| Y | Estimated Landed Cost | Currency | 183,68 |
| Z | Estimated Margin | Currency | 216,32 |
| AA | Commission Agent Rate (%) | Number | 8 |
| AB | Commission Agent (€) | Currency | 32,00 |
| AC | Commission Area Manager (€) | Currency | 0,00 |
| AD | Commission Subject 1 (€) | Currency | 36,00 |
| AE | Commission Subject 2 (€) | Currency | 7,40 |
| AF | Total Commissions | Currency | 75,40 |
| AG | Second Margin (after commissions) | Currency | 140,92 |
| AH | Geographical Zone | Text | 01 |
| AI | Geographical Zone Description | Text | TRIVENETO |
| AJ | Order Type | Text | Progr |
| AK | Delete Reason | Text | (empty) |
| AL | Delete Date | Date | (empty) |
| AM | VAT Registration No | Text | IT01907140931 |
| AN | Vendor | Text | FUJIAN A.W INTERNATIONAL TRADE CO. |
| AO | Anomalo Flag | Text | X |
| AP | Currency | Text | EUR |
| AQ | Blocked | Number | 0 |

**Total: ~44 columns**

### Sheet 2: Analisi WMS

**12 columns** da QuantityReadyForShipping* fields

### Sheet 3: Margini & Commissioni

**15 columns** aggregated by season/salesperson

### Sheet 4: Dati Articoli

**20 columns** Item attributes

### Sheet 5: Metadati

**12 rows** of metadata

---

## 📋 Example Data Row

```
Document No_    : OV-26/00272
Line No_        : 10000
Order Date      : 19/01/26
Salesperson     : PIANO B SRL (code 1050)
Customer        : EMME.E DI MICHELUTTO ELISABETTA (C06995)
Season          : I26
Article         : F6STAR01/LAM
Color           : BEI (Beige)
Qty Sold        : 1 pair = 8 units
Value Sold      : €400.00
Qty Shipped     : 0
Value Shipped   : €0.00
Qty Invoiced    : 0
Status          : Ready for Shipping (Total qty 0 / Pairs 0)
Landed Cost     : €22.96 per pair
Est. Cost       : €183.68 (8 pairs × €22.96)
Margin          : €216.32 (€400 - €183.68)
Commissions:
  - Agent (8%)        : €32.00
  - Area Manager (0%) : €0.00
  - Subject1 (9%)     : €36.00
  - Subject2 (1.85%)  : €7.40
  - Total             : €75.40
Second Margin   : €140.92 (€216.32 - €75.40)
Zone            : TRIVENETO (01)
Vendor          : FUJIAN A.W INTL TRADE CO.
VAT Number      : IT01907140931
```

---

## 🚀 Implementation for Luke

### Step 1: Create tRPC Endpoint

```typescript
// apps/api/src/routers/analysis.ts

trpc.router()
  .query('venditeDettaglio', {
    input: z.object({
      dateFrom: z.date(),
      dateTo: z.date(),
      filters: z.object({
        seasons: z.array(z.string()).optional(),
        customers: z.array(z.string()).optional(),
        salespersons: z.array(z.string()).optional(),
      }).optional(),
    }),
    async resolve({ input }) {
      // Query udf_SalesFinal with filters
      const data = await queryNav.udf_SalesFinal(input);

      // Calculate margins
      const enriched = await marginService.calculateMargins(data);

      return enriched.map(row => ({
        // Map to Excel columns
        DocumentNo: row.documentNo,
        LineNo: row.lineNo,
        OrderDate: row.orderDate,
        // ... etc
      }));
    }
  })
  .mutation('exportExcel', {
    input: z.object({
      // Same as venditeDettaglio
    }),
    async resolve({ input }) {
      const data = await this.query('venditeDettaglio', input);

      // Generate Excel
      const buffer = await excelService.generateAnalisiVenditeExcel(data);

      return {
        buffer,
        filename: `AnalisiVendite_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      };
    }
  })
```

### Step 2: Frontend Dashboard

```typescript
// apps/web/pages/analysis/vendite.tsx

export default function AnalisiVendite() {
  const [filters, setFilters] = useState({
    dateFrom: subMonths(today(), 1),
    dateTo: today(),
  });

  const { data, isLoading } = trpc.analysis.venditeDettaglio.useQuery(filters);
  const { mutate: exportExcel } = trpc.analysis.exportExcel.useMutation();

  return (
    <div>
      <AnalysisFilters value={filters} onChange={setFilters} />

      <SalesTable data={data} columns={VENDITE_COLUMNS} />

      <button onClick={() => exportExcel(filters)}>
        Export to Excel
      </button>
    </div>
  );
}
```

---

## ✅ Implementation Checklist

### Phase 1: MVP (Week 1)
- [ ] udf_SalesBase, udf_SalesEnriched, udf_SalesFinal (SQL)
- [ ] marginService.calculateMargins() (TypeScript)
- [ ] tRPC endpoint: analysis.venditeDettaglio (query)
- [ ] Excel export: Sheet 1 only (40 columns)

### Phase 2: Enhanced (Week 2)
- [ ] Sheet 2: WMS analysis
- [ ] Sheet 3: Margin aggregation
- [ ] tRPC mutation: analysis.exportExcel
- [ ] Frontend dashboard with filters

### Phase 3: Polish (Week 3)
- [ ] Sheet 4: Item lookup
- [ ] Sheet 5: Metadata
- [ ] Formatting: colors, currency, dates
- [ ] Performance optimization

---

## 🎯 Key Decisions

**1. Column reduction: 232 → 40 (MVP)** ✅
- Semplificare per MVP
- Aggiungere altri sheet per dettagli

**2. Calculation location** ✅
- SQL: Raw values + lookup
- Backend: Margin/commission calculations
- Excel: SUM formulas per totals

**3. Multi-sheet structure** ✅
- Sheet 1: Daily reporting (main)
- Sheet 2: WMS tracking
- Sheet 3: Analysis/summary
- Sheets 4-5: Reference data

---

**Status:** 🟢 **SPECIFICATION READY FOR IMPLEMENTATION**

**Next:** Start with udf_SalesBase SQL conversion (FASE 3 Phase 1)

