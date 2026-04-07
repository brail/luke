# Executive Summary — NewEraStat.accdb Analysis

**Data:** 2026-03-26
**Scope:** Complete reverse engineering of Access reporting database
**Output:** Optimization & simplification recommendations for Luke porting

---

## 🎯 What NewEraStat.accdb Does

**Type:** Statistical reporting dashboard for sales analysis

**Flow:**
```
VBA Form (UI) → Filtri multi-selezione (stagione, marchio, cliente, agente)
                ↓
            Query SQL (def01-ANALISIVENDUTO-PIVOT-step0)
                ↓
        20,000+ char mega-query
        (11 JOINs, 200+ campi, 7 calcoli)
                ↓
            Excel export
        "NewEra-AnalisiVendite.xlsx"
```

**Key Features:**
- Multi-dimensional analysis (sales by customer, item, salesperson, zone, etc.)
- Margin calculation (landed cost - commissions)
- WMS shipment state tracking
- Carry-over analysis (inventory from previous seasons)
- Customer credit risk evaluation

**Users:** Commercial team, management (reports, dashboard, forecasting)

---

## 🔴 Critical Issues Found

### Issue 1: INNER JOIN su DatiCarryOverESMU
**Problem:** Query esclude articoli senza carry-over
**Impact:** Torna meno righe di qSoloVend-step1 (query precedente)
**Fix:** Cambia a LEFT JOIN oppure pre-popola carry-over in step1

### Issue 2: 200+ Campi in 1 Query
**Problem:** Ultra-long SELECT clause, difficile da leggere/manutenere
**Impact:** Hard to understand which fields are essential
**Fix:** Split in 3 steps (base → enriched → final)

### Issue 3: Calcoli Margine in SQL
**Problem:** 7 colonne derivate (margin, 4 commissioni, second margin)
**Impact:** Risk di rounding errors, dipendenza da NULL values
**Fix:** Sposta a backend TypeScript con Decimal precision

### Issue 4: 3 Geographical Zone JOINs su Stessa Tabella
**Problem:** Same table joined 3 times per 3 diverse zone fields
**Impact:** Ridondante, inefficiente
**Fix:** Normalizza a 2 zone fields in base query

### Issue 5: Molti IIf() per Lookup Codes
**Problem:** Access-specific logic per convert codes to descriptions
**Impact:** Dovrebbe essere in lookup table, non SQL formula
**Fix:** Usa CASE WHEN e lookup table

---

## 💡 Optimization Recommendations

### Tier 1: MUST DO (Performance + Maintainability)

#### Recommendation 1.1: Split Query in 3 Functions
**Benefit:** Leggibilità 10x, manutenibilità, testabilità
**Effort:** 1 day
**Result:**
```
udf_SalesBase()      — base sales + customer (2 JOINs, ~15 campi)
  ↓
udf_SalesEnriched()  — + item/color/zones/carry-over (7 JOINs, ~40 campi)
  ↓
udf_SalesFinal()     — + commission rates (~50 campi)
```

**Advantage:**
- ✅ Step 1 cacheable (immutable after order)
- ✅ Step 2 testable separately
- ✅ Step 3 composable with other data
- ✅ Performance profiling per step

#### Recommendation 1.2: Move Margin Calculations to Backend
**Benefit:** Type-safe (Decimal), testable, reusable
**Effort:** 1.5 days
**Result:**
```typescript
// Backend: apps/api/src/services/margins.ts
export async function calculateMargins(rows: SalesRow[]) {
  return rows.map(row => ({
    ...row,
    // FROM SQL
    valueSold: row.valueSold,
    pairsSold: row.pairsSold,
    landedCost: row.landedCost,

    // CALCULATED
    estimatedLandedCostOnSold: row.pairsSold * row.landedCost,
    estimatedMargin: row.valueSold - (row.pairsSold * row.landedCost),
    commissions: {
      agent: (row.valueSold * row.commissionAgentRate) / 100,
      areaManager: (row.valueSold * row.commissionAreaManagerRate) / 100,
      // ... etc
    },
    secondMargin: /* calculated after commissions */
  }))
}
```

**Advantage:**
- ✅ Decimal precision (no rounding errors)
- ✅ Unit testable with fixed data
- ✅ Easy to debug breakpoint
- ✅ Reusable across APIs
- ✅ Edge case handling (NULL, zero division)

#### Recommendation 1.3: Normalize Geographical Zones
**Benefit:** Remove 2 redundant JOINs, cleaner logic
**Effort:** 0.5 days
**Result:** In udf_SalesBase, add:
```sql
SalesZone.Description AS SalesZoneDescription,
ShipZone.Description AS ShipZoneDescription
-- NO third zone (consolidate if needed)
```

### Tier 2: SHOULD DO (Architecture + Flexibility)

#### Recommendation 2.1: Make DatiCarryOverESMU a View
**Benefit:** Becomes persistent, transparent
**Effort:** 0.5 days
**Current:** Table (popola chi?)
**After:** VIEW su base carry-over logic
**Result:** INNER JOIN diventa LEFT JOIN safely

#### Recommendation 2.2: Separate Excel Sheets by Domain
**Benefit:** Leggibilità, composability
**Current:** 200+ campi in 1 sheet
**After:**
- Sheet 1: Sales Base (15 campi)
- Sheet 2: Item Details (20 campi)
- Sheet 3: Margin Analysis (10 campi derivati)
- Sheet 4: Customer Details (on-demand, separate query)

#### Recommendation 2.3: Create Customer/Item Lookup Endpoints
**Benefit:** Dynamic filter UI, no hardcoded lists
**Effort:** 2 days
**Result:**
```typescript
// tRPC endpoints
trpc.analysis.getAvailableSeasons()
trpc.analysis.getAvailableCustomers()
trpc.analysis.getAvailableItems()
trpc.analysis.getAvailableSalespersons()
```

### Tier 3: NICE TO HAVE (UX + Polish)

#### Recommendation 3.1: Dashboard Visualization
**Benefit:** Real-time insights
**Effort:** 2-3 days
**Tools:** Recharts, Victory.js, D3.js

#### Recommendation 3.2: Export Formats
**Benefit:** Flexibility
**Options:**
- Excel (primary)
- CSV (legacy)
- PDF (print-ready)
- JSON (API)

#### Recommendation 3.3: Scheduled Regeneration
**Benefit:** Fresh data nightly
**Effort:** 1 day
**Pattern:**
```typescript
// Every night at 2 AM
cron("0 2 * * *", async () => {
  const data = await udf_SalesFinal();
  const enriched = await calculateMargins(data);
  await cacheRedis.set("analysis:latest", enriched, { ttl: 86400 })
});
```

---

## 📊 Data Model Changes Required

### Current (Access)

```
NewEraStat.accdb
├── qSoloVend-step0 (raw Sales Line)
├── qSoloVend-step1 (grouped Sales Line)
└── def01-ANALISIVENDUTO-PIVOT-step0 (enriched + calcs)
```

### Proposed (Luke)

```
@luke/nav/src/statistics/
├── queries/
│   ├── sales-base.sql         ← udf_SalesBase()
│   ├── sales-enriched.sql     ← udf_SalesEnriched()
│   └── sales-final.sql        ← udf_SalesFinal()
├── index.ts
└── (export typed functions)

@luke/core/src/schemas/
├── analysis.ts
│   ├── SalesBaseRow (Zod schema)
│   ├── SalesEnrichedRow
│   └── SalesFinalRow

apps/api/src/routers/
├── analysis.ts
│   ├── tRPC .query.sales()
│   ├── tRPC .mutation.exportExcel()
│   └── middleware: cache, auth

apps/api/src/services/
└── margins.ts
    ├── calculateMargins()
    ├── calculateSecondMargin()
    └── validateMarginLogic()

apps/web/src/
├── hooks/useAnalysis.ts
├── pages/analysis/index.tsx
└── components/
    ├── AnalysisFilters.tsx
    ├── SalesTable.tsx
    └── MarginChart.tsx
```

---

## 📈 Effort Breakdown (Total: 6-7 days)

| Phase | Effort | Tasks |
|-------|--------|-------|
| **Jet → T-SQL** | 0.5d | Regex conversion, syntax check |
| **Query Splitting** | 1.0d | 3 functions, test each |
| **Backend Margins** | 1.5d | Decimal precision, edge cases, unit tests |
| **Excel Template** | 1.5d | exceljs, multi-sheet, formula |
| **tRPC Endpoints** | 1.0d | Routing, input validation, caching |
| **Frontend Dashboard** | 1.5d | Filters, table, charts |
| **Testing & Polish** | 0.5d | E2E, performance, docs |
| **Total** | **7.5 days** | |

---

## 🚀 Recommended Implementation Order

### Phase 1: Queries (Days 1-2)

1. Convert jet SQL → T-SQL (automated + manual)
2. Create udf_SalesBase() — test with known data
3. Create udf_SalesEnriched() — validate row counts
4. Create udf_SalesFinal() — validate commission rates

**Output:** 3 Stored Functions in SQL Server

### Phase 2: Backend (Days 3-4)

5. Implement `calculateMargins()` service
6. Unit tests (100+ test cases for edge cases)
7. Add margin schema in `@luke/core`
8. Create tRPC endpoint `analysis.sales()`

**Output:** Working API endpoint `/api/analysis/sales`

### Phase 3: Frontend (Days 5-7)

9. Create filters component (season, customer, salesperson)
10. Implement data table (sortable, paginated)
11. Add export to Excel button
12. E2E tests + performance tuning

**Output:** Production-ready dashboard

---

## ✅ Quality Checklist

### SQL Quality
- [ ] No INNER JOINs on optional lookups
- [ ] NULL handling explicit (COALESCE/ISNULL)
- [ ] Indexes on JOIN keys present
- [ ] Execution plan reviewed (<2s for typical query)

### Backend Quality
- [ ] Decimal precision for all money calcs
- [ ] Error handling for missing data
- [ ] Input validation (date ranges, filters)
- [ ] Caching strategy defined (Redis TTL)

### Frontend Quality
- [ ] Responsive design (mobile-friendly)
- [ ] Loading states + error messages
- [ ] Accessibility (WCAG 2.1)
- [ ] Performance (<3s to display table)

---

## 📞 Questions to Answer

Before starting implementation, clarify:

1. **DatiCarryOverESMU**
   - What is this? Temporary table? View?
   - Who populates it? VBA? Scheduled job?
   - Should it be mandatory (INNER) or optional (LEFT)?

2. **Performance Requirements**
   - How many rows typically? (per season, per customer filter)
   - Max acceptable query time?
   - Export size limit?

3. **Approval Workflow**
   - Who signs off on reports?
   - Audit trail required?
   - Archive old exports?

4. **User Permissions**
   - Who can export?
   - Can users filter by customer/salesperson restricted to them?
   - Admin-only features?

5. **Data Refresh**
   - Real-time? Or nightly batch?
   - Incremental updates or full recompute?

---

## 🎯 Success Criteria

✅ **Functionality:**
- All 200+ fields available in Excel export
- Margin calculations accurate to 0.01 EUR
- Filters work correctly (multi-select)

✅ **Performance:**
- Query <2s (for typical year/season)
- Export <5s (100k rows)
- Dashboard loads <3s

✅ **Maintainability:**
- Code is documented (comments on joins, calcs)
- Unit tests >80% coverage
- No hardcoded values (all parameterized)

✅ **User Experience:**
- No errors/alerts on happy path
- Clear error messages on failures
- Intuitive UI (similar to Access form)

---

## 📋 Next Actions

### Immediate (This Week)

1. **Confirm DatiCarryOverESMU semantics** — Critical blocker
2. **Get SQL Server environment ready** — For testing
3. **Review & approve query split proposal** — Before coding

### Ready to Code (Next Week)

4. **Phase 1: T-SQL Conversion** — Start with udf_SalesBase()
5. **Phase 2: Backend Service** — calculateMargins() logic
6. **Phase 3: Frontend Dashboard** — tRPC integration

---

## 📚 Reference Documents

All documents available in `docs/access-porting/`:

- `README.md` — Project overview
- `VBA_ANALYSIS.md` — VBA code & functions breakdown
- `SQL_DEEP_DIVE.md` — Detailed query analysis with optimizations
- `PORTING_GUIDE.md` — Jet SQL → T-SQL conversion patterns
- `ANALYSIS_SUMMARY.md` — This document

---

**Status:** 🟢 **ANALYSIS COMPLETE & READY FOR IMPLEMENTATION**

**Decision Point:** Approve query splitting + margin calculation approach before coding starts.

Ready to proceed to Phase 1? 🚀
