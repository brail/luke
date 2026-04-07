# Query SQL Template — Estrazione Manuale da Access

**Istruzioni:**
1. Apri NewEraStat.accdb in Access
2. Per ogni query nella lista sottostante, estrai il SQL
3. Copia il contenuto SQL e incollalo qui, sostituendo `[PASTE SQL HERE]`
4. Salva il file
5. Esegui: `python3 scripts/split_queries_to_files.py` per generare i file `.sql`

---

## QRY_001 — 000-Analisi Per Sistemazione SPLIT IVA YOOX-aggiorna sped reg

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `000-Analisi Per Sistemazione SPLIT IVA YOOX-aggiorna sped reg`

---

## QRY_002 — 000-Analisi Per Sistemazione SPLIT IVA YOOX-verifica

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `000-Analisi Per Sistemazione SPLIT IVA YOOX-verifica`

---

## QRY_003 — 000-Stefania-ControlloFatturatoEContoEconomica-step1

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `000-Stefania-ControlloFatturatoEContoEconomica-step1`

---

## QRY_004 — AA- AGGIORNA DATI PER SPLIT IVA 3 - sales shipment line

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `AA- AGGIORNA DATI PER SPLIT IVA 3 - sales shipment line`

---

## QRY_005 — AnalisiDateConsegnaVendite-step0

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `AnalisiDateConsegnaVendite-step0`

---

## QRY_006 — FattureRegistrateEDDt

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `FattureRegistrateEDDt`

---

## QRY_007 — OrdiniQuantitaSpeditaDaSorgenteRigheSpedizioniRegistrate

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `OrdiniQuantitaSpeditaDaSorgenteRigheSpedizioniRegistrate`

---

## QRY_008 — RigaFatturaPerresi-step1

```sql
-- [PASTE SQL HERE]
```

**Fonte:** Access query `RigaFatturaPerresi-step1`

---

## Note per l'estrazione

### Come ottenere il SQL da Access

**Su Windows + Access:**
1. Apri il database
2. Seleziona la query
3. Tasto destro → Design View
4. Seleziona View → SQL View (oppure Ctrl+Shift+V)
5. Copia tutto il testo (Ctrl+A → Ctrl+C)
6. Incolla qui

**Alternativa:** File → Database Documenter → esporta in PDF/Word

### Informazioni da includere (opzionali ma utili)

Dopo il SQL, aggiungi un commento:
```sql
-- TIPO: [Select / Crosstab / Action / Pass-Through]
-- USA: [Sales Header / Sales Line / Shipment / ...]
-- PARAMETRI: [@DataDa / @DataA / @CodiceFornitore]
```

### Se una query è corrotta o non leggibile

Segnala nella lista sottostante:
- **QRY_NNN:** [descrizione errore]

---

## Status estrazione

- [ ] QRY_001 estratta
- [ ] QRY_002 estratta
- [ ] QRY_003 estratta
- [ ] QRY_004 estratta
- [ ] QRY_005 estratta
- [ ] QRY_006 estratta
- [ ] QRY_007 estratta
- [ ] QRY_008 estratta

**Data completamento:** ___________

---

## Dopo aver completato

Salva il file e esegui:

```bash
cd docs/access-porting
python3 scripts/split_queries_to_files.py
```

Questo genererà automaticamente:
```
queries/
├── QRY_001_Analisi_Per_Sistemazione_SPLIT_IVA_YOOX.sql
├── QRY_002_Analisi_Per_Sistemazione_SPLIT_IVA_YOOX_verifica.sql
├── ...
└── QRY_008_RigaFatturaPerresi_step1.sql
```

Poi procederemo a **FASE 2** — Analisi e documentazione.
