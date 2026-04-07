# ✅ FASE 2 — COMPLETATA

## 📊 Estrapolazione e Analisi Query

**Data:** 2026-03-26
**Status:** ✅ Completata
**Prossima:** FASE 3 — Porting T-SQL

---

## 📁 Output Generati

### Documentazione Principale

| File | Descrizione | Link |
|------|-------------|------|
| **QUERIES_ANALYSIS.md** | Analisi statistica 1111 query | 📊 |
| **PORTING_GUIDE.md** | Guida conversione Jet SQL → T-SQL | 🔧 |
| **FASE_2_ANALYSIS.md** | Piano dettagliato porting (MVP strategy) | 📋 |
| **raw/queries_statistics.json** | Statistiche JSON (per automation) | 📈 |

### File Query Estratti

| Location | Quantità | Formato | Status |
|----------|----------|---------|--------|
| `queries/custom/q2/queries/` | 1111 | `.sql` files | ✅ Completo |
| `queries/custom/q2/queries.jsonl` | 1111 | JSONL metadata | ✅ Completo |
| `queries/custom/q2/vba_modules/` | 34 | `.bas/.cls` VBA | ✅ Completo |
| `queries/custom/q2/vba_functions.sql` | N/A | SQL extract | ✅ Completo |
| `queries/custom/q2/vba_index.json` | N/A | VBA metadata | ✅ Completo |

---

## 📈 Statistiche Finali

### Overview

```
Total Queries:        1,111
├── Visible:          1,106 (99.5%)
├── System (~sq_):       5
└── NAV-related:       969 (87.2%)

Complexity Distribution:
├── Bassa (Simple):   1,011 (91%)   ← MVP foundation
├── Media:               95 (8.5%)   ← Core features
└── Alta (Complex):       5 (0.5%)   ← Advanced features
```

### Tabelle NAV Referenziate

Identificate da query naming patterns:
- **Sales** — Vendite, Spedizioni, Fatture
- **Purchase** — Acquisti, Ricezioni
- **Items** — Articoli, Varianti
- **Customers & Vendors** — Parti, Anagrafiche
- **Ledgers** — Registri, Voci contabili

### Query Dependencies

- **509 query** (45.8%) hanno dipendenze da altre query
- **Multi-step patterns** (step0 → step1 → step2 → report)
- **UNION queries** per consolidamenti (15 query)

---

## 🎯 MVP Porting Strategy

### Scopo

Portare **5-10 query principali** che coprono:
- 80% dei use case
- Validano l'architettura @luke/nav
- Permettono integrazione frontend rapida

### Wave 1: Foundation (3 query semplici)

| # | Query | Complexity | Tipo | Purpose | ETA |
|---|-------|-----------|------|---------|-----|
| 1 | `0-NEWERA-PARTITECLIENTI-STEP0` | Bassa | SELECT+GROUP | Test pipeline | 30 min |
| 2 | `qSoloVend-step0` | Bassa | SELECT+JOIN | Sales extraction | 30 min |
| 3 | `CalcoloDisponibilita-step0` | Bassa | SELECT+JOIN | Stock available | 30 min |

**Output:** 3 Stored Procedures validate in SQL Server

### Wave 2: Core (5-7 query medie)

| # | Query | Complexity | Purpose |
|---|-------|-----------|---------|
| 4 | `qSoloVendItem-step1` | Media | Sales detail by item |
| 5 | `def01-ANALISIVENDUTO-PIVOT-step0` | Media | Revenue analysis (PIVOT) |
| 6 | `VenditeEPrenotazioni-CalcoloTotaleCoperto-step0` | Media | Order fulfillment |
| 7 | `AnalisiCredito-step0` | Media | Customer credit standing |
| 8 | `GraficoMiglioriArticoliVenduti` | Media | Top selling items |

**Output:** 7 tRPC endpoints + frontend dashboard

### Wave 3: Remaining (95+ query)

Per fasi successive, a seconda priorità business.

---

## 🔧 Conversion Patterns Identified

### Most Common Issues (800+ query occurrences)

1. **Date literals** `#2023-01-01#` → `'2023-01-01'`
   - Trovate in 450+ query
   - Conversione automatizzabile con regex

2. **IIf() conditional**
   - Trovate in 280+ query
   - Necessita conversione manuale per evitare errori logici
   - Pattern: `IIf(cond, true, false)` → `CASE WHEN cond THEN true ELSE false END`

3. **Val() type casting**
   - Trovate in 190+ query
   - Spesso ridondante (colonne già numeriche)
   - Conversione: `Val(col)` → `CAST(col AS DECIMAL(18,4))`

4. **String concat &**
   - Trovate in 120+ query
   - Conversione semplice: `s1 & s2` → `s1 + s2`

5. **DateDiff usage**
   - Trovate in 60+ query
   - ⚠️ **ATTENZIONE:** Ordine parametri è corretto
   - Access: `DateDiff('d', d1, d2)` = SQL Server: `DATEDIFF(DAY, d1, d2)`

---

## 📋 Checklist Porting

### Pre-Porting

- [x] Query estratte (1111)
- [x] VBA modules estratti (34)
- [x] Analisi completed
- [x] MVP queries identified
- [x] Porting guide creato
- [ ] **→ PROSSIMO:** Conversion tooling setup

### Per Ogni Query (Wave 1-2)

- [ ] SQL extracted da `queries/custom/q2/queries/QRY_NNN.sql`
- [ ] Conversion completata (Jet SQL → T-SQL)
- [ ] Syntax validation in SSMS or sqlcmd
- [ ] Data validation (row count, sample rows)
- [ ] Stored Procedure creata in SQL Server
- [ ] Documentation updated
- [ ] tRPC endpoint implemented
- [ ] Unit tests written
- [ ] Frontend component created

### Integration Checklist

- [ ] `@luke/nav/src/statistics/queries/` aggiornato
- [ ] `packages/nav/index.ts` exports updated
- [ ] `apps/api/src/routers/statistics.ts` endpoints added
- [ ] `apps/web/src/hooks/useStatistics.ts` created
- [ ] Dashboard components implemented
- [ ] E2E tests passing

---

## 📚 Documentation Files

**Tutti presenti in `docs/access-porting/`:**

```
access-porting/
├── README.md                    ← Overview progetto
├── TASK_access_porting.md       ← Istruzioni originali
├── FASE_1_STATUS.md             ← Stato FASE 1
├── FASE_2_ANALYSIS.md           ← Analisi FASE 2 (questo)
├── FASE_2_COMPLETE.md           ← Summary FASE 2
├── QUERIES_ANALYSIS.md          ← Analisi statistica query
├── PORTING_GUIDE.md             ← Conversion guide
├── REVERSE_ENGINEERING.md       ← Query catalog (skeleton)
├── QUERIES_TEMPLATE.md          ← Template SQL compilation
├── queries/custom/q2/
│   ├── queries/                 ← 1111 SQL files
│   ├── queries.jsonl            ← Metadata JSONL
│   ├── queries.sql              ← Combined SQL
│   ├── vba_modules/             ← 34 VBA modules
│   ├── vba_functions.sql        ← VBA functions
│   └── vba_index.json           ← VBA metadata
├── raw/
│   ├── tables.txt               ← Database tables
│   ├── queries_list.json        ← Query list
│   ├── queries_statistics.json  ← Statistics JSON
│   └── metadata_*.csv           ← Configuration data
├── scripts/
│   ├── extract_accdb.py
│   ├── analyze_accdb_structure.py
│   ├── analyze_extracted_queries.py
│   └── split_queries_to_files.py
└── [altri file...]
```

---

## 🚀 Prossimi Step (FASE 3)

### Immediate (Today)

1. **Scegli prima query da convertire**
   - Consiglio: `0-NEWERA-PARTITECLIENTI-STEP0` (molto semplice)

2. **Setup SQL Server environment**
   - Verifica accesso NAV database
   - Crea schema per Stored Procedures porting
   - Setup test environment

### Phase 3a: Manual Conversion (1-2 days)

1. Estrai SQL da `queries/custom/q2/queries/`
2. Applica conversion patterns da `PORTING_GUIDE.md`
3. Testa in SSMS / sqlcmd
4. Valida row count vs Access

### Phase 3b: Automation (1 day)

1. Crea Python script per conversione batch
   - Date literals
   - String concat
   - IIf → CASE
   - Val → CAST

2. Applica a Wave 1 + Wave 2 queries

### Phase 3c: Integration (2-3 days)

1. Crea `@luke/nav/src/statistics/queries/` structure
2. Add Stored Procedures to SQL Server
3. Implement tRPC endpoints
4. Build frontend dashboard

---

## 📊 Effort Estimate

| Fase | Activity | Days | Notes |
|------|----------|------|-------|
| **Phase 3a** | Manual conversion (5 queries) | 1.5 | Test pipeline |
| **Phase 3b** | Automation scripting | 1.0 | Batch conversion |
| **Phase 3c** | Integration in Luke | 2.5 | API + Frontend |
| **Phase 4** | Advanced queries (30-50) | 3-5 | As needed |
| **Total MVP** | | **8-9 days** | Full MVP ready |

---

## 🎓 Learnings & Recommendations

### Per il Porting

1. **Start Simple**
   - Prima query deve essere < 200 chars SQL
   - Valida il pipeline end-to-end
   - Build confidence per query complesse

2. **Automate Repetitive**
   - Write regex/Python per conversioni pattern
   - Test su campione prima di batch
   - Keep manual QA step per validazione

3. **Preserve Business Logic**
   - Non "ottimizzare" query durante porting
   - Il goal è replicare Access behavior esattamente
   - Ottimizzazione in una fase successiva

4. **Documentation First**
   - Scrivi comment header prima del SQL
   - Document ogni conversion decision
   - Facilita review e manutenzione futura

### Per il Team

1. **Access database è una miniera di logica di business**
   - 1111 query = ~10 anni di iterazione
   - Vale la pena preservare e capire

2. **Multi-step queries sono pattern**
   - step0 = raw data extraction
   - step1 = transformation
   - step2 = aggregation
   - Final = reporting

3. **VBA logica può essere semplificata**
   - Molte funzioni VBA sono workarounds Access
   - In SQL Server nativo, semplificabili
   - Es: formattazione → spostare al frontend

---

## ✅ Completamento FASE 2

**Tutti gli obiettivi raggiunti:**

- [x] Estrazioni query completate (1111)
- [x] Analisi query (statistiche, dipendenze, complessità)
- [x] VBA modules identificati (34)
- [x] MVP strategy definita (3 + 5-7 query)
- [x] Porting guide completato
- [x] Conversion patterns documented
- [x] Tooling identified (Python regex, SSMS, sqlcmd)

---

## 📞 Ready for FASE 3

**Requisiti per procedere:**

1. ✅ SQL Server access (NAV database)
2. ✅ SSMS or sqlcmd CLI
3. ✅ Python 3 per script conversion
4. ✅ Luke monorepo setup

**Punto di partenza:** Scegli prima query e iniziamo porting! 🚀

---

**Next meeting:** Setup FASE 3 — Conversione prima query MVP

Pronto? 🎯
