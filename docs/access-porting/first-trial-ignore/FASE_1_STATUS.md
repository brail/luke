# FASE 1 — Estrazione Raw — STATUS

## ✅ Completato

### 1a. Rilevamento e estrazione automatica

**Strumenti utilizzati:**
- `mdbtools` su macOS per lettura file .accdb
- Python 3 per orchestrazione estrazione
- Script: `scripts/extract_accdb.py`, `scripts/analyze_accdb_structure.py`, `scripts/extract_queries_list.py`

**Output generati in `raw/`:**

| File | Contenuto | Status |
|---|---|---|
| `tables.txt` | 55 tabelle (locali) | ✅ Completo |
| `queries_list.json` | 8 query identificate da metadata | ✅ Completo |
| `QUERIES_SUMMARY.md` | Mapping tabelle → query | ✅ Completo |
| `STRUCTURE_ANALYSIS.md` | Analisi struttura NAV-related | ✅ Completo |
| `metadata_TabelleInQuery.csv` | Relazioni tabella-query | ✅ Estratto |
| `metadata_Indici.csv` | Indici database (8630 righe) | ✅ Estratto |
| `metadata_TranscodificaTabelle370NewEra.csv` | Tracodifica dati | ✅ Estratto |
| `vba_modules.txt` | Placeholder VBA | ⚠️ Richiede estrazione manuale |
| `forms_list.txt` | Placeholder form | ⚠️ Richiede estrazione manuale |
| `reports_list.txt` | Placeholder report | ⚠️ Richiede estrazione manuale |

### 1b. Query identificate

**8 query trovate:**

1. `000-Analisi Per Sistemazione SPLIT IVA YOOX-aggiorna sped reg`
2. `000-Analisi Per Sistemazione SPLIT IVA YOOX-verifica`
3. `000-Stefania-ControlloFatturatoEContoEconomica-step1`
4. `AA- AGGIORNA DATI PER SPLIT IVA 3 - sales shipment line`
5. `AnalisiDateConsegnaVendite-step0`
6. `FattureRegistrateEDDt`
7. `OrdiniQuantitaSpeditaDaSorgenteRigheSpedizioniRegistrate`
8. `RigaFatturaPerresi-step1`

---

## ⚠️ Limitazioni tecniche

### Cos'è stato estratto automaticamente
- ✅ Nomi e struttura tabelle
- ✅ Nomi query da system tables
- ✅ Dati di configurazione e metadata
- ✅ Relazioni tabella-query

### Cosa richiede estrazione manuale

**Definizioni SQL delle query** — .accdb memorizza le query come oggetti binari non leggibili da `mdbtools`:
- **Causa:** SQL Server Access Database non espone direttamente le definizioni query tramite driver ODBC su macOS
- **Soluzione richiesta:** Manuale dalle opzioni sotto

**Moduli VBA** — Richiedono accesso COM API:
- Non disponibile su macOS senza Access installato
- Richiede export via Access UI o Windows COM

**Form/Report metadata** — Oggetti binari:
- Nomi form estratti da system tables
- Struttura dettagliata richiede COM API

---

## 📋 Prossimo passo (FASE 2)

**Estrazione manuale delle definizioni query**

Scegli uno dei seguenti metodi:

### Opzione A: Windows + Access UI (🟢 Consigliato)
```
1. Apri NewEraStat.accdb in Microsoft Access (Windows)
2. Per ogni query in QUERIES_SUMMARY.md:
   - Tasto destro → Design View
   - Copia il SQL (View → SQL View)
   - Incolla in docs/access-porting/queries/QRY_NNN_nome.sql
3. Per ogni modulo VBA:
   - Tasto destro → Export
   - Salva in docs/access-porting/vba_manual/
```

### Opzione B: Python + pyodbc (Windows)
```bash
pip install pyodbc
# Poi riesegui extract_accdb_advanced.py
```

### Opzione C: Docker (Multi-platform)
```bash
# Container con Python + ODBC driver
docker run -v $(pwd):/work --rm python:3.11 bash
pip install pyodbc
python /work/docs/access-porting/scripts/extract_accdb_advanced.py
```

### Opzione D: Online Converter (🟡 Veloce ma con limitazioni)
- Carica NewEraStat.accdb su https://www.zamzar.com/
- Converti a SQLite
- Estrai query da SQLite

---

## 📊 Conteggio preliminary

```
Database: NewEraStat.accdb
├── Tabelle: 55
├── Query: 8 (nomi estratti, SQL in sospeso)
├── NAV Table references: Sales Shipment Line
├── VBA modules: [Da determinare]
├── Forms: [Da determinare]
└── Reports: [Da determinare]
```

---

## ✅ Checklist FASE 1

- [x] Ambiente rilevato (macOS + mdbtools disponibile)
- [x] Script di estrazione creati (`scripts/`)
- [x] Tabelle estratte (`raw/tables.txt`)
- [x] Query identificate (`raw/queries_list.json`)
- [x] Metadata analizzati (`raw/metadata_*.csv`)
- [x] REVERSE_ENGINEERING.md skeleton creato
- [ ] **BLOCCO:** Definizioni SQL query da estrarre manualmente
- [ ] VBA modules (estrazione manuale)
- [ ] Forms/Reports metadata (estrazione manuale)

---

## Istruzioni per continuare

**Una volta che hai estratto le query SQL:**

1. Crea directory: `docs/access-porting/queries/`
2. Per ogni query, salva file:
   ```
   QRY_001_nome.sql
   QRY_002_nome.sql
   ...
   ```
3. Scrivi un breve commento header in ogni file SQL:
   ```sql
   -- QRY_NNN: Nome query originale
   -- Usata in: [tabelle correlate]
   -- Logica: [descrizione brevissima]

   [SQL qui]
   ```

4. Avvisa quando i file SQL sono pronti → procederò a FASE 2

---

**Status:** 🟡 **FASE 1 PARZIALMENTE COMPLETATO — IN SOSPESO ESTRAZIONE MANUALE**
