# Access Database Porting — NewEraStat.accdb → Luke

## 📋 Panoramica

Questo progetto reverse-engineering il database Microsoft Access **NewEraStat.accdb** per portarne le query statistiche nel sistema **Luke** (Fastify API + Next.js frontend).

**Status corrente:** 🟡 **FASE 1 — Estrazione in corso**

---

## 📁 Struttura

```
docs/access-porting/
├── README.md                          # Questo file
├── TASK_access_porting.md            # Istruzioni complete (originale)
├── FASE_1_STATUS.md                  # Status estrazione (LEGGERE!)
├── REVERSE_ENGINEERING.md            # Documentazione query (in progress)
├── QUERIES_TEMPLATE.md               # Template per SQL (DA COMPILARE)
├── NewEraStat.accdb                  # File sorgente Access
├── scripts/                           # Script Python per estrazione
│   ├── extract_accdb.py              # Estrazione tabelle
│   ├── analyze_accdb_structure.py    # Analisi struttura
│   ├── extract_queries_list.py       # Estrazione nomi query
│   └── split_queries_to_files.py     # Split SQL in file
├── raw/                              # Output estrazione automatica
│   ├── tables.txt                    # 55 tabelle identificate
│   ├── queries_list.json             # 8 query riconosciute
│   ├── QUERIES_SUMMARY.md            # Mapping tabelle-query
│   ├── STRUCTURE_ANALYSIS.md         # Analisi NAV
│   └── metadata_*.csv                # Dati config estratti
└── queries/                          # Output query SQL (DA COMPLETARE)
    └── QRY_NNN_*.sql                 # File query vuoti, pronti per SQL
```

---

## ✅ FASE 1 — Estrazione Raw [IN CORSO]

### ✓ Completato (Automatico)

- [x] **Identificazione ambiente:** macOS + mdbtools disponibile
- [x] **Estrazione tabelle:** 55 tabelle estratte in `raw/tables.txt`
- [x] **Identificazione query:** 8 query trovate in metadata
- [x] **Mapping tabelle-query:** Creato in `raw/metadata_TabelleInQuery.csv`
- [x] **Analisi struttura NAV:** Esportata in `raw/STRUCTURE_ANALYSIS.md`
- [x] **Skeleton REVERSE_ENGINEERING.md:** Pronto per compilazione
- [x] **Template query SQL:** Creato `QUERIES_TEMPLATE.md` per estrazione manuale

### ⚠️ IN SOSPESO (Richiede azione dell'utente)

**Estrazione definizioni SQL delle 8 query**

Poiché .accdb memorizza query come oggetti binari non leggibili da mdbtools, richiedo:

| Metodo | Piattaforma | Facilità | Tempo | Note |
|--------|-------------|---------|-------|------|
| **Access UI** | Windows | 🟢 Alto | ~15 min | Consigliato |
| **pyodbc** | Windows | 🟡 Medio | ~10 min | Richiede setup |
| **Docker** | Any | 🟡 Medio | ~20 min | Containerizzato |
| **Online converter** | Any | 🟡 Medio | ~10 min | Zamzar → SQLite |

**→ Vedi `FASE_1_STATUS.md` per istruzioni dettagliate**

---

## 📝 Come procedere

### Passo 1: Estrai SQL delle 8 query

Scegli uno dei metodi in `FASE_1_STATUS.md` (consiglio: Windows + Access UI)

Oppure, se hai già il SQL disponibile:
1. Apri `QUERIES_TEMPLATE.md`
2. Per ogni query `QRY_001` ... `QRY_008`, sostituisci `[PASTE SQL HERE]` con il SQL
3. Salva il file

### Passo 2: Genera file SQL individuali

```bash
cd docs/access-porting
python3 scripts/split_queries_to_files.py
```

Output: `queries/QRY_NNN_*.sql` (8 file con SQL estratto)

### Passo 3: Avvia FASE 2

Una volta completati i passaggi sopra:
```bash
python3 scripts/analyze_queries.py  # DA CREARE
```

Questo:
- Parserà ogni SQL
- Identificherà tabelle NAV coinvolte
- Determinerà complessità e dipendenze
- Aggiornerà `REVERSE_ENGINEERING.md`

---

## 📊 Conteggio Database

```
NewEraStat.accdb
├── Tabelle totali: 55
│   ├── NAV-related: ~10
│   ├── Temp/Working: ~20
│   ├── Configuration: ~5
│   └── Other: ~20
├── Query identificate: 8
│   ├── Nomi estratti: ✓
│   ├── SQL: ⏳ [in sospeso]
│   ├── Tipo (Select/Crosstab/Action): ❓
│   └── Dipendenze: ❓
├── VBA modules: [Da estrarre]
├── Forms: [Da estrarre]
└── Reports: [Da estrarre]
```

---

## 🔗 Dipendenze da Luke

### @luke/nav (già esistente)

Il package `@luke/nav` è già configurato nel monorepo con:
- Accesso mssql a NAV database
- Query builder helper
- Export Excel

**Utilizzeremo per:**
- Aggiungere nuove funzioni query statistiche in `src/statistics/`
- Seguire pattern di sync NAV esistenti (Vendor, Brand, Season)

### @luke/core

Per validare output query:
- Zod schemas in `packages/core/src/schemas/nav.ts`
- Utility type per risposta statistiche

### apps/api

tRPC endpoints per:
- `/api/statistics/query1`
- `/api/statistics/query2`
- ecc.

---

## 📅 Fasi pianificate

| Fase | Descrizione | Status | ETA |
|------|-------------|--------|-----|
| **1** | Estrazione raw + query identification | 🟡 In corso | ← ORA |
| **2** | Analisi reverse engineering query | ⏳ Blocked on SQL extraction | |
| **3** | Riscrittura T-SQL pulito | ⏳ After Phase 2 | |
| **4** | Integrazione in @luke/nav | ⏳ After Phase 3 | |
| **5** | tRPC endpoints + frontend | ⏳ After Phase 4 | |

---

## 📞 Blocchi e supporto

### Blocco corrente

**SQL delle 8 query non ancora estratte**

Soluzioni:
1. Estrai manualmente da Windows + Access (⭐ consigliato)
2. Usa pyodbc su Windows
3. Usa Docker multi-platform
4. Usa online converter (Zamzar)

→ Leggi `FASE_1_STATUS.md` per metodo per metodo

### Se hai domande

- Consulta `TASK_access_porting.md` per specifiche complete
- Controlla `REVERSE_ENGINEERING.md` per catalogo query (skeleton pronto)
- Vedi `raw/QUERIES_SUMMARY.md` per mapping tabelle

---

## 🛠 Comandi rapidi

```bash
# Vedi tabelle estratte
cat raw/tables.txt

# Vedi query identificate
cat raw/QUERIES_SUMMARY.md

# Vedi struttura NAV
cat raw/STRUCTURE_ANALYSIS.md

# Compila template SQL
nano QUERIES_TEMPLATE.md

# Genera file SQL
python3 scripts/split_queries_to_files.py

# Vedi file SQL generati
ls -la queries/
```

---

## ✅ Checklist FASE 1

- [x] Ambiente rilevato
- [x] Tabelle estratte (55)
- [x] Query identificate (8)
- [x] Metadata analizzati
- [x] Skeleton REVERSE_ENGINEERING.md creato
- [x] Template query creato
- [x] Script helper creati
- [ ] **→ PROSSIMO:** SQL query estratti manualmente
- [ ] File QRY_NNN_*.sql generati
- [ ] REVERSE_ENGINEERING.md compilato (FASE 2)

---

**Ultimo aggiornamento:** 2026-03-26
**Status:** 🟡 FASE 1 — In sospeso estrazione manuale SQL
