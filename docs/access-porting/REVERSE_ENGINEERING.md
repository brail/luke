# Reverse Engineering — Access Statistics Module (NewEraStat.accdb)

## Panoramica

- **N. query totali:** 1155
- **N. moduli VBA:** 8 (Form_~TMPCLP64331, Form_CambiaPassword, Form_Login, Form_Principale, Form_DatiCommercialiClienti, Form_Fornitori, Form_Marchi, ModuloStandard)
- **Form:** 11 — il principale è `Form_Principale` (581 controlli, 6189 righe VBA)
- **Report:** 43

**Distribuzione tipi query:**
| Tipo | Codice | N. |
|------|--------|----|
| SELECT | 0 | 941 |
| UPDATE/Action (Append/Make/Delete) | 48/80/240 | 110+ |
| UNION / UNION ALL | 128 | 66 |
| Procedure (INSERT parametrico) | 29 | 29 |
| Pass-Through | 32 | 4 |

**Classificazione funzionale:**
| Area | Query totali | Di cui STEP | Candidati al porting |
|------|-------------|-------------|----------------------|
| VENDUTO_COMPRATO | 30 | 10 | 8 |
| ANALISI_VENDUTO / CONFRONTO STAGIONI | 9 | 1 | 6 |
| CREDITI_PAGAMENTI | 55 | 30 | 8 |
| LOGISTICA_WMS | 37 | 15 | 5 |
| EAN_ETICHETTE | 54 | 20 | 3 |
| ASSORTIMENTI | 13 | 5 | 3 |
| MAGAZZINO_INVENTARIO | 16 | 5 | 4 |
| ACQUISTI_CONSEGNE | 25 | 10 | 4 |
| LISTINI_PREZZI | 20 | 8 | 3 |
| NOTE_CREDITO_RESI | 7 | 2 | 4 |
| VENDITE_PRENOTAZIONI | 8 | 3 | 3 |
| BUDGET | 11 | 4 | 2 |
| POSIZIONAMENTO | 3 | 0 | 2 |
| CONTABILITA | 1 | 0 | 1 |
| EXPORT_ORDINI | 1 | 0 | 1 |
| LEGACY/000 | 131 | — | 0 (non portare) |
| ACTION (UPDATE/DELETE) | 149 | — | 0 (non portare) |
| STEP intermedi orfani | 251 | — | 0 (non portare) |

**Query selezionate per documentazione dettagliata:** 57

**Tabelle NAV referenziate (principali via ODBC → DSN=NewEra, DATABASE=FEBOS_10):**
| Tabella NAV | Uso principale |
|-------------|----------------|
| `[Sales Header]` | Intestazioni ordini/fatture di vendita |
| `[Sales Line]` | Righe ordini di vendita |
| `[Sales Invoice Header]` | Fatture registrate intestazione |
| `[Sales Invoice Line]` | Fatture registrate righe |
| `[Sales Cr_Memo Header]` | Note di credito registrate intestazione |
| `[Sales Cr_Memo Line]` | Note di credito registrate righe |
| `[Purchase Header]` | Ordini di acquisto intestazione |
| `[Purchase Line]` | Ordini di acquisto righe |
| `[Purch_ Rcpt_ Header]` | Ricevimenti acquisto intestazione |
| `[Purch_ Rcpt_ Line]` | Ricevimenti acquisto righe |
| `[Item]` | Anagrafica articoli |
| `[Item Ledger Entry]` | Movimenti di magazzino |
| `[Customer]` | Anagrafica clienti |
| `[Vendor]` | Anagrafica fornitori |
| `[Variable Code]` | Codici colore/variante |
| `[Salesperson_Purchaser]` | Agenti/acquirenti |
| `[Geographical Zone]` | Zone geografiche |
| `[G_L Entry]` | Movimenti contabilità generale |
| `[DDT_Picking Header]` | Intestazioni DDT/spedizioni |
| `[DDT_Picking Line]` | Righe DDT/spedizioni |
| `[Assortment Ledger Entry]` | Movimenti assortimento |
| `[Assortment Quantity]` | Quantità assortimento |
| `[Cust_ Ledger Entry]` | Partite clienti |
| `[Detailed Cust_ Ledg_ Entry]` | Movimenti dettagliati partite clienti |
| `[Budget Header]` / `[Budget Line]` | Budget |
| `[External Linked Documents]` | Documenti collegati (immagini) |

**Nota sulla connessione:** tutte le tabelle NAV sono linked via ODBC con DSN=NewEra, UID=FebosStatUser, DATABASE=FEBOS_10. Il company prefix nelle query Access è assente perché le linked table non usano la notazione `[CompanyName$TableName]` tipica dei NAV export — usano i nomi semplici. Nel porting T-SQL usare il placeholder `[AZIENDA$NomeTabella]`.

---

## Catalogo completo query per area funzionale

### Area: VENDUTO_COMPRATO (nucleo analitico principale)

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 1 | `qAcq` | Select | Alta | Base acquisti per articolo/colore/assortimento con cambio EUR/USD |
| 2 | `qAcqGrouped` | Select | Media | Aggregazione di qAcq per chiave articolo-colore-assortimento |
| 3 | `qVend` | Select | Alta | Base vendite con calcolo commissioni agente/area manager |
| 4 | `qVendGrouped` | Select | Media | Aggregazione di qVend per chiave articolo-colore-assortimento |
| 5 | `def01-qAcqEVend-Both` | Select | Media | JOIN tra acquisti e vendite (articoli con entrambi) |
| 6 | `def01-qAcqEVend-AcqOnly` | Select | Media | Solo articoli con acquisti senza corrispondente vendita |
| 7 | `def01-qAcqEVend-VendOnly` | Select | Media | Solo articoli con vendite senza corrispondente acquisto |
| 8 | `def01-qAcqEVend-Union` | Union | Alta | UNION ALL dei tre precedenti (dataset completo) |
| 9 | `def01-qAcqEVend-ZFinal-PerAnalisi` | Select | Alta | Arricchisce Union con delta/proiezioni/previsioni, legge FattoreCorrettivo dal Form |
| 10 | `def01-qAcqEVend-ZFinal-PerAnalisi-MoreData` | Select | Media | Aggiunge KPI forecast e sellable sopra ZFinal |
| 11 | `def01-qAcqEVend-Item-AcqOnly` | Select | Media | Come AcqOnly ma con granularità Item (no colore) |
| 12 | `def01-qAcqEVend-Item-Both` | Select | Media | Come Both ma con granularità Item |
| 13 | `def01-qAcqEVend-Item-VendOnly` | Select | Media | Come VendOnly ma con granularità Item |
| 14 | `def01-qAcqEVend-Item-Union` | Union | Alta | UNION dei tre Item precedenti |
| 15 | `def01-qAcqEVend-Item-ZFinal-PerAnalisi` | Select | Alta | Come ZFinal ma per Item |
| 16 | `VendutoCompratoProiezione-preexport` | Select | Alta | Pre-export proiezione con dati vendor/item |
| 17 | `VendutoCompratoProiezioneItem-preexport` | Select | Alta | Come sopra a granularità Item |
| 18 | `VendutoCompratoProiezioneTabella_Duplicati` | Select | Bassa | Controllo duplicati nella tabella di staging |
| 19 | `ReportVendutoComprato-NonProiettato-Vendite` | Select | Media | Vendite non proiettate per report |
| 20 | `ReportVendutoComprato-NonProiettato-Acquisti` | Select | Media | Acquisti non proiettati per report |
| 21 | `ReportVendutocomprato-NonProiettato` | Select | Media | Join report venduto/comprato con immagini e carry-over |
| 22 | `ReportVendutoComprato-NonProiettato-BOTH` | Select | Media | Variante BOTH del report |
| 23 | `ReportVendutoComprato-NonProiettato-SOLOACQ` | Select | Media | Variante solo acquisti |
| 24 | `ReportVendutoComprato-NonProiettato-Acquisti` | Select | Media | Variante solo vendite |
| 25 | `BudgetVend-Union` | Union | Alta | UNION budget + vendite per confronto |
| 26 | `BudgetVend-Both` | Select | Media | Intersezione budget-vendite |
| 27 | `BudgetVend-SoloBudget` | Select | Media | Solo righe budget senza vendita |
| 28 | `BudgetVend-SoloVend` | Select | Media | Solo righe vendita senza budget |

### Area: ANALISI_VENDUTO / CONFRONTO STAGIONI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 29 | `GraficoMiglioriArticoliVenduti-step0` | Select | Alta | Base ordini di vendita per report migliori articoli con moltiplicatore |
| 30 | `GraficoMiglioriArticoliVenduti` | Select | Alta | Report migliori articoli con immagini, carry-over, listini |
| 31 | `GraficoMiglioriArticoliVenduti-Fornitore` | Select | Alta | Come sopra con raggruppamento per fornitore |
| 32 | `GraficoMiglioriArticoliVendutiEstrazione` | Select | Alta | Versione per export Excel con status articolo |
| 33 | `def01-ANALISIVENDUTO-ConfrontoStagioni` | Select | Alta | Confronto paia/valore tra 2 stagioni con data cut-off |
| 34 | `def01-ANALISIVENDUTOITEM-ConfrontoStagioni` | Select | Alta | Come sopra a granularità Item |
| 35 | `def01-ANALISIVENDUTO-PIVOT` | Select | Media | Wrapper su pivot con campi di check |
| 36 | `AnnullamentiAgenteCliente` | Select | Media | Annullamenti vs conferme per agente/cliente/articolo |
| 37 | `confrontoStagioni-step0` | Select | Alta | Base confronto 3 stagioni per agente/cliente |
| 38 | `confrontoStagioni-step1` | Select | Media | Aggregazione confronto stagioni per agente/cliente |

### Area: CREDITI / PAGAMENTI / INSOLUTI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 39 | `AnalisiCredito-RicercaAnomalie` | Select | Molto Alta | Analisi ordini anomali con dati Cerved/Cribis, fido, pagamenti |
| 40 | `AnalisiCredito-RicercaAnomalie_Sommario` | Select | Media | Sommario anomalie per zona/credit manager |
| 41 | `AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi` | Select | Bassa | Clienti con metodi pagamento multipli |
| 42 | `tempiPagQueryDefinitiva` | Select | Alta | Analisi tempi di pagamento con soglie configurabili |
| 43 | `tempiPagDatiMarchiSuRigheFattureNDC` | Union | Media | Marchi su righe fatture + NDC |
| 44 | `ControlloCCBancariRiba` | Select | Media | Ordini RIBA senza coordinate bancarie |

### Area: FATTURATO / NOTE CREDITO / RESI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 45 | `fab01-FatturatoESconti-step01` | Select | Media | Fatture registrate con dimensione marchio via PostedDocumentDimension |
| 46 | `fab01-FatturatoESconti-step02` | Select | Alta | Fatturato per cliente/marchio/periodo con sconti riga e fattura |
| 47 | `fab02-NoteCreditoESconti-step01` | Select | Media | Note credito con dimensione marchio |
| 48 | `fab02-NoteCreditoESconti-step02` | Select | Alta | Note credito aggregate per cliente/marchio/periodo |
| 49 | `NDCRegistrate-VerificaCondizioniSconto` | Select | Media | NDC con righe tipo testo contenenti "SCO" (condizioni sconto) |
| 50 | `def01-ANALISINOTEDICREDITO-PIVOT` | Select | Alta | Analisi note credito e resi con classificazione articolo |
| 51 | `NDCRegistrateEResi` | Select | Media | Union NDC registrate e resi da Sales Cr Memo |
| 52 | `FattureENDCRegistrate` | Union | Media | Union fatture + NDC per riconciliazione |

### Area: MAGAZZINO / INVENTARIO

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 53 | `InventarioAllaData-PerGiacenzaGiornaliera` | Procedure | Alta | INSERT giornaliero: giacenza cumulata da Item Ledger Entry per data specifica |
| 54 | `GiacenzaAssortimenti` | Select | Media | Giacenza per assortimento/colore/locazione |
| 55 | `giac-04-giacenzaAssortimentiLibera` | Select | Alta | Giacenza libera assortimenti (al netto di prenotato) |
| 56 | `ControlloGiacenzaPaiaLibere-final` | Union | Alta | Controllo paia libere con riconciliazione vendite/spedizioni |

### Area: ACQUISTI / CONSEGNE

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 57 | `AnalisiDateConsegna` | Select | Alta | Analisi date consegna acquisti vs ordine con dati fornitore |
| 58 | `AnalisiDateConsegnaVendite` | Select | Alta | Analisi date consegna vendite con tipo ordine e zona geografica |

### Area: ASSORTIMENTI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 59 | `AssortimentiQuantita` | Select | Bassa | Quantità per assortimento e gruppo variabili |
| 60 | `AssortimentiQuanrtita_SingoloGruppoVariabili` | Select | Bassa | Come sopra per singolo gruppo variabili |

### Area: LOGISTICA / WMS

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 61 | `WMS_AnalisiStatusDDT` | Select | Media | Riepilogo conteggio DDT per status/statusWHSE |
| 62 | `WMS_WarehouseShipment` | Select | Media | Spedizioni warehouse con status box |
| 63 | `AnalisiUsciteDDT` | Select | Alta | Uscite DDT per stagione/marchio (wrapper step0) |
| 64 | `CarichiNegozioOutletDaDdt` | Select | Media | Carichi negozio outlet da DDT con EAN code |

### Area: VENDITE / PRENOTAZIONI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 65 | `VenditeEPrenotazioni` | Select | Alta | Portafoglio ordini attivi + prenotazioni (wrapper pre-export) |
| 66 | `VenditeEPrenotazioni-preExport` | Select | Alta | Pre-export portafoglio con copertura prenotazioni |

### Area: LISTINI / PREZZI

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 67 | `ListinoVenditaWholesaleRaggruppato` | Select | Media | Listino wholesale per articolo/colore aggregato |
| 68 | `ListinoVenditaRetailRaggruppato` | Select | Media | Listino retail per articolo/colore aggregato |

### Area: POSIZIONAMENTO

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 69 | `AnalisiPosizionamento` | Select | Alta | Posizionamento per taglia con prezzi wholesale e retail |

### Area: EXPORT / CONTABILITA

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 70 | `EstrazioneOrdiniVenditaCostoEXWFOB` | Select | Alta | Ordini di vendita con costo EXW/FOB per analisi marginalità |
| 71 | `BilancioPerSorgente` | Select | Alta | Movimenti CoGe raggruppati per sorgente con dimensioni |

### Area: UTILITY

| # | Nome Access | Tipo | Complessità | Note |
|---|------------|------|-------------|------|
| 72 | `Immagini` | Select | Bassa | Immagini articoli da External Linked Documents |

### Area: ACTION QUERIES (non portare — solo inventario)

| # | Nome Access | Tipo | Descrizione |
|---|------------|------|-------------|
| — | `000_dam_aggiorna clienti date per fatturazione elettronica` | UPDATE | Aggiorna date FE su Customer Recipient Relation — operazione one-shot |
| — | `000_dam_analisi trasferimenti magazzino transito errato_MOD_*` | UPDATE | Correzione manuale Location Code su Item Ledger Entry — one-shot |
| — | `InventarioAllaData-PerGiacenzaGiornaliera` | INSERT | Usata in loop VBA per costruire andamento inventario giornaliero |
| — | `AggiornaDisponibilitaKimo` | UPDATE | Aggiorna disponibilità verso sistema Kimo — integrazioni esterne |
| — | `delete from saleslinetmp` (inline) | DELETE | Pulizia tabella temporanea per elaborazione EAN |
| — | Circa 140 altre UPDATE/DELETE/MAKE | — | Interventi manuali, correzioni one-shot, manutenzione dati |

### Area: QUERY LEGACY/000 (non portare)

Tutte le 131 query con prefisso `000_` sono operazioni one-shot, check manuali, analisi su dati storici hardcoded, o bozze. Esempi rappresentativi:
- `000_Apepazza Per Mapcite_v1/v2` — estrazione geografica hardcoded su stagione E24 e zona 33
- `000_BOZZA ANALISI NOTE CREDITO QUALUTA CONTO CG` — analisi su periodo fisso 2021-2022
- `000_dam_*` — interventi correttivi manuali su NAV
- `000_kimo_*` — interfaccia con sistema Kimo (legacy)

---

## Query analizzate in dettaglio

### QRY_001 — AcquistiBase (qAcq)

**Nome Access:** `qAcq`
**Tipo:** Select
**Usata in:** `qAcqGrouped` (aggregazione) → `def01-qAcqEVend-Both/AcqOnly` → tutta la catena VendutoComprato
**Complessità:** Alta — calcola 14 metriche derivate da campi NAV, gestisce conversione valuta USD/EUR

**Scopo business:**
Estrae tutte le righe di ordini di acquisto con le quantità ordinate, ricevute e fatturate, e calcola il valore corrispondente in EUR applicando il cambio USD/EUR letto dal Form Principale. È il fondamento del confronto Venduto/Comprato.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `[Purchase Line]` | — | Base | Document Type, No_, Constant Variable Code, Assortment Code, No_ of Pairs, Quantity, Av_ Net Unit Cost, Currency Code, Quantity Received, Quantity Invoiced |
| `[Sales Header]` | — | — | (non presente — le vendite vengono dal lato qVend) |

**Logica chiave:**
- `QuantityPurchased = Val([Quantity])` — gestisce NULL con Val()
- `ValuePurchased = Val([Av_ Net Unit Cost]) * Val([No_ of Pairs])`
- `ValuePurchasedEur`: se Currency = "USD" → divide per cambio da `[forms]![principale]![cambioeurodollaro]`; se EUR o vuoto → valore diretto; altrimenti "ERROR CURRENCY NOT AVAILABLE"
- `PairsReceived = If qty>0 Then qty_received/qty * pairs ELSE 0` — calcolo proporzionale
- `ValueReceived` e `ValueInvoicedPurchases` con stessa logica proporzionale

**Parametri:**
- `[forms]![principale]![cambioeurodollaro]` → `@CambioUSDEUR DECIMAL(10,4)` — cambio per conversione valuta acquisti USD

**Dipendenze da altre query Access:** nessuna (query base)

**Note per il porting:**
- Val() in Access gestisce NULL e string vuota restituendo 0 — usare `ISNULL([campo], 0)` e `TRY_CAST` o `CASE WHEN ISNUMERIC`
- La logica proporzionale per PairsReceived assume che il rapporto qty/qty_received sia costante per l'intero ordine
- Il parametro cambioUSD viene letto live dal form — in Luke sarà un parametro di chiamata API

---

### QRY_002 — VenditeBase (qVend)

**Nome Access:** `qVend`
**Tipo:** Select
**Usata in:** `qVendGrouped` → tutta la catena VendutoComprato; `def01-ANALISIVENDUTO-*`
**Complessità:** Alta — calcola commissioni, valore spedito/fatturato, gross vs net

**Scopo business:**
Estrae tutte le righe di ordini di vendita con paia vendute, valore netto (al netto degli sconti), valore lordo, e calcola le commissioni dell'agente e del capo zona. Include anche le proporzioni spedito/fatturato.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `[Sales Line]` | — | Base | Document Type, No_, Quantity, No_ of Pairs, Assortment Code, Constant Variable Code, Delete Reason, Line Amount, Inv_ Discount Amount, Average Unit Price, Currency Code, Quantity Shipped, Quantity Invoiced, Area Manager Commission_, Salesperson Commission_ |
| `[Sales Header]` | — | INNER JOIN | No_, Salesperson Code |
| `[Salesperson_Purchaser]` | — | (via Sales Header) | Name |

**Logica chiave:**
- `ValueSold = Val([Line Amount]) - Val([Inv_ Discount Amount])` — valore netto riga
- `GrossSalesValue = Val([Average Unit Price]) * Val([No_ of Pairs])` — valore lordo
- `DiscountValue = GrossSalesValue - ValueSold`
- `AreaManagerCommissionValue = Val(Nz([Area Manager Commission_])) * ValueSold / 10`
- `SalesPersonCommissionValue = Val(Nz([Salesperson Commission_])) * ValueSold / 100`
- Le righe con delete_reason valorizzato sono INCLUSE (filtro avviene a monte in step successivi)

**Parametri:** nessuno diretto (il filtro stagione/marchio viene iniettato dinamicamente dal VBA)

**Note per il porting:**
- Il campo `Area Manager Commission_` usa divisione per 10 (le commissioni sono in decimi di percentuale in NAV)
- `Nz()` → `ISNULL(campo, 0)`
- In Luke separare il calcolo commissioni in una funzione utility

---

### QRY_003 — VendutoCompratoUnion (def01-qAcqEVend-Union)

**Nome Access:** `def01-qAcqEVend-Union`
**Tipo:** Union (Unknown(128))
**Usata in:** `def01-qAcqEVend-ZFinal-PerAnalisi` → report ReportVendutoComprato, export VBA
**Complessità:** Alta — UNION ALL a 3 rami con colonne costanti

**Scopo business:**
Consolida in un unico dataset tutti gli articoli del confronto venduto/comprato: quelli con sia vendite che acquisti, quelli con solo acquisti (da piazzare), quelli con sole vendite (da comprare).

**Logica chiave:**
- Ramo 1 (`Both`): articoli con acquisti E vendite — tutti i valori reali
- Ramo 2 (`AcqOnly`): acquisti senza vendita corrispondente — colonne vendite = 0
- Ramo 3 (`VendOnly`): vendite senza acquisto corrispondente — colonne acquisti = 0/""
- La chiave di matching è: `Articolo + CodiceColore + Assortimento`

**Note per il porting:**
- In T-SQL usare `UNION ALL` (non UNION) per evitare la deduplicazione implicita
- Il matching articolo-colore-assortimento è a tre livelli — verificare con il business se questa granularità è corretta in Luke

---

### QRY_004 — VendutoCompratoAnalisi (def01-qAcqEVend-ZFinal-PerAnalisi)

**Nome Access:** `def01-qAcqEVend-ZFinal-PerAnalisi`
**Tipo:** Select
**Usata in:** `def01-qAcqEVend-ZFinal-PerAnalisi-MoreData`, Report `ReportConfrontoVendutoComprato`
**Complessità:** Molto Alta — 20+ colonne calcolate, legge 2 parametri dal Form, join multipli

**Scopo business:**
Il cuore del sistema di analisi venduto/comprato. Aggiunge al dataset Union tutti i dati di anagrafica articolo, calcola i delta (quante paia comprare o piazzare), e proietta le vendite future applicando il fattore correttivo definito dall'utente.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `def01-qAcqEVend-Union` | — | Base | tutti i campi |
| `[Item]` | — | INNER JOIN | Description 2, Vendor No_, Trademark Code, Collection Code, Season Code, Line Code, Season Typology, Product Family, Product Sex, Shipment Priority |
| `[Vendor]` | — | LEFT JOIN | Name (VendorName) |
| `[Variable Code]` | — | LEFT JOIN | Description (Color) |
| `DatiCarryOverESMU` | — | LEFT JOIN | Carry Over, Smu |

**Parametri:**
- `[forms]![principale]![fattorecorrettivo]` → `@FattoreCorrettivo DECIMAL(5,4)` — moltiplicatore previsione vendite (es: 1.10 = +10%)

**Logica chiave:**
- `deltaPiazzarePairs = IF PairsSold - PairsPurchased < 0 THEN (PairsSold - PairsPurchased) ELSE 0` — eccesso acquisti da piazzare
- `deltaComprarePairs = IF PairsSold - PairsPurchased > 0 THEN (PairsSold - PairsPurchased) ELSE 0` — deficit acquisti da comprare
- `SalesForecastPairs = FattoreCorrettivo * PairsSold` — proiezione flat su paia
- `SalesForecastAssortmentPairs = ROUND(FattoreCorrettivo * QuantitySold) * PairsSold / QuantitySold` — proiezione per assortimento

**Note per il porting:**
- Il `FattoreCorrettivo` è un parametro critico: in Luke andrà come input nel form di analisi con default 1.0
- I calcoli `deltaPiazzare*` e `deltaComprare*` sono mutualmente esclusivi (uno è sempre 0)
- `DatiCarryOverESMU` è una tabella locale Access (non NAV) — da valutare se portare o eliminare

---

### QRY_005 — MiglioriArticoliVenduti (GraficoMiglioriArticoliVenduti)

**Nome Access:** `GraficoMiglioriArticoliVenduti`
**Tipo:** Select
**Usata in:** Report `MiglioriArticoliVenduti`, `MiglioriArticoliVenduti-LineaModello`, export VBA
**Complessità:** Alta — 7 LEFT JOIN incluse tabelle locali

**Scopo business:**
Produce il ranking degli articoli venduti per stagione/marchio, arricchito con immagini, carry-over, SMU, percentuali di linea e articolo, e listini wholesale/retail. Usato per i report "migliori articoli" che guidano le decisioni di acquisto.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `GraficoMiglioriArticoliVenduti-step0` | — | Base | tutti (paia, marchio, stagione, linea) |
| `Immagini` | — | LEFT JOIN | Linked Document |
| `GraficoMiglioriArticoliVenduti-step1` | — | LEFT JOIN | PaiaPerLinea (peso % della linea) |
| `GraficoMiglioriArticoliVenduti-step2` | — | LEFT JOIN | PaiaPerArticolo (peso % dell'articolo) |
| `ListinoVenditaWholesaleRaggruppato` | — | LEFT JOIN | ListinoWholesale |
| `ListinoVenditaRetailRaggruppato` | — | LEFT JOIN | ListinoRetail |
| `DatiCarryOverESMU-Completi` | — | LEFT JOIN | Carry Over (da tabella locale) |

**Dipendenze da altre query Access:**
- `GraficoMiglioriArticoliVenduti-step0` — base vendite con moltiplicatore
- `ListinoVenditaWholesaleRaggruppato/RetailRaggruppato` — listini aggregati
- `Immagini` — wrapper su External Linked Documents
- `DatiCarryOverESMU-Completi` — tabella locale Access con dati carry-over

**Note per il porting:**
- `DatiCarryOverESMU-Completi` è una tabella locale Access non presente in NAV — verificare se il dato carry-over esiste in NAV o va creato in Luke
- La funzione `append()` (VBA custom) usata nei listini per concatenare valori multipli → in T-SQL usare `STRING_AGG()`
- Il `moltiplicatore` in step0 consente di gonfiare artificialmente le paia (es: per proiezioni) — in Luke sarà un parametro

---

### QRY_006 — ConfrontoStagioni (confrontoStagioni-step1)

**Nome Access:** `confrontoStagioni-step1`
**Tipo:** Select
**Usata in:** Report `ReportConfrontoStagioniAgente`
**Complessità:** Alta — legge 3 parametri stagione + 3 parametri data cut-off

**Scopo business:**
Confronto delle vendite per agente e cliente su 3 stagioni diverse, con paia e valore. Permette al management di vedere se un agente sta crescendo, mantenendo o perdendo clienti tra le stagioni.

**Tabelle NAV coinvolte (via step0):**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `[Sales Line]` | — | Base | Document Type, Delete Reason, No_ of Pairs, Line Amount, Inv_ Discount Amount |
| `[Sales Header]` | — | INNER JOIN | Salesperson Code, Sell-to Customer No_, Document Type |
| `[Salesperson_Purchaser]` | — | LEFT JOIN | Name |
| `[Customer]` | — | (via Sales Header) | Name |
| `[Item]` | — | (via Sales Line) | Season Code |

**Parametri:**
- `[forms]![principale]![FiltroStagione1]` → `@Stagione1 VARCHAR(10)`
- `[forms]![principale]![FiltroStagione2]` → `@Stagione2 VARCHAR(10)`
- `[forms]![principale]![FiltroStagione3]` → `@Stagione3 VARCHAR(10)`

**Logica chiave (step0):**
```
PairsS1 = IIF(season = Stagione1, No_of_Pairs, 0)
SalesValueS1 = IIF(season = Stagione1, LineAmount - InvDiscount, 0)
-- ripetuto per S2 e S3
```
step1 fa GROUP BY su SalespersonCode, Salesperson, CustomerCode, CustomerName con SUM() di tutte le colonne.

**Note per il porting:**
- Il pattern IIF+GROUP BY è un crosstab "manuale" su 3 stagioni — in T-SQL usare CASE WHEN + SUM + GROUP BY (o PIVOT)
- `[maschere]![principale]` in step0 è un alias obsoleto per `[forms]![principale]` — stessa cosa

---

### QRY_007 — AnalisiVendutoConfrontoStagioni (def01-ANALISIVENDUTO-ConfrontoStagioni)

**Nome Access:** `def01-ANALISIVENDUTO-ConfrontoStagioni`
**Tipo:** Select
**Usata in:** Export VBA per analisi confronto stagioni avanzato
**Complessità:** Alta — 6 parametri dal Form, logica di cut-off data complessa

**Scopo business:**
Versione avanzata del confronto stagioni che permette di confrontare il portafoglio ordini a una data specifica (cut-off) per ciascuna stagione. Permette di rispondere a "a parità di data, quanti ordini avevamo nella stagione precedente vs questa stagione?"

**Parametri:**
- `[forms]![principale]![filtroconfrontostagione1]` → `@Stagione1 VARCHAR(10)`
- `[forms]![principale]![datacutoffstagione1]` → `@CutOff1 DATE`
- `[forms]![principale]![filtroconfrontostagione2]` → `@Stagione2 VARCHAR(10)`
- `[forms]![principale]![datacutoffstagione2]` → `@CutOff2 DATE`

**Logica chiave:**
- `TestOrdineAttivoAllaDataCutOff`: ordine attivo se: stagione = S1 AND order_date <= CutOff1 AND (delete_date = '1753-01-01' OR delete_date > CutOff1)
- La data `#1/1/1753#` è il "null date" di NAV Business Central (minima data supportata)

**Note per il porting:**
- La data `1753-01-01` in NAV equivale a NULL logico — in T-SQL trattare come `IS NULL OR delete_date > @CutOff`
- `[forms]![principale]![datacutoffstagione1]` → @CutOff DATE

---

### QRY_008 — AnnullamentiPerAgente (AnnullamentiAgenteCliente)

**Nome Access:** `AnnullamentiAgenteCliente`
**Tipo:** Select
**Usata in:** Report `AnnullamentiAgenteCliente` (filtro: Marchio, Stagione, CodiceAgente)
**Complessità:** Media — aggregazione con IIF su delete_reason

**Scopo business:**
Per ogni agente/cliente/articolo/colore, mostra le paia annullate (delete_reason='art') vs le paia confermate. Usato dalla direzione commerciale per analizzare la qualità degli ordini presi dagli agenti.

**Tabelle NAV coinvolte (via def01-ANALISIVENDUTO-PIVOT):**
- `[Sales Line]` — tramite il pivot, con campi: season, trademark, salesperson, customer, line, article, color, delete_reason, pairsquantity, salesvalue

**Logica chiave:**
```sql
PaiaAnnullate = SUM(IIF(delete_reason = 'art', pairsquantity, 0))
ValoreAnnullato = SUM(IIF(delete_reason = 'art', salesvalue, 0))
PaiaConfermate = SUM(IIF(delete_reason = '' OR delete_reason IS NULL, pairsquantity, 0))
```

**Note per il porting:**
- In T-SQL: `SUM(CASE WHEN delete_reason = 'art' THEN pairsquantity ELSE 0 END)`
- Il filtro di visualizzazione (Marchio, Stagione, Agente) viene applicato come WHERE nel report Access — in Luke sarà un filtro API

---

### QRY_009 — FatturatoESconti (fab01-FatturatoESconti-step02)

**Nome Access:** `fab01-FatturatoESconti-step02`
**Tipo:** Select
**Usata in:** Report `fab01-FatturatoESconti-step02` (filtro per data documento)
**Complessità:** Alta — join con tabella dimensioni postata

**Scopo business:**
Fatturato per cliente con dettaglio sconti riga e sconti fattura, classificazione Italia/Estero, per un intervallo di date. Base del report mensile/periodico del fatturato.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---------|-------|-----------|-------------|
| `[Sales Invoice Line]` | — | Base | Quantity, Line Discount Amount, Inv_ Discount Amount, Amount, Type |
| `[Sales Invoice Header]` | — | INNER JOIN | Document Date, No_, Currency Code, Sell-to Customer No_ |
| `[Customer]` | — | INNER JOIN | No_, Name, Name 2, Credit Limit |
| `[Posted Document Dimension]` | — | INNER JOIN | Table ID=113, Dimension Code='marchio', Dimension Value Code (= Marchio) |

**Parametri (applicati nel report):**
- `[Document Date]` Between `@DataIniziale DATE` And `@DataFinale DATE`

**Logica chiave:**
- Join su `[Posted Document Dimension]` con Table ID = 113 (Sales Invoice Line) e Dimension Code = 'marchio' per ottenere il marchio dalla dimensione
- `ImportoLordo = ImportoNetto + ScontoRiga + ScontoFattura`
- `Paese = IIF([Gen_Bus_Posting Group] = 'NAZIONALE', 'ITALIA', 'ESTERO')`
- `WHERE [Sales Invoice Line].Type = 2` — solo righe articolo (esclude commenti, costi, ecc.)

**Note per il porting:**
- La Join su `[Posted Document Dimension]` è il modo NAV 2013 di leggere le dimensioni — in NAV moderno (BC) le dimensioni sono in `[Dimension Set Entry]`. Verificare quale tabella è disponibile.
- ⚠️ CHIARIMENTO RICHIESTO: In NAV FEBOS_10 è presente `[Dimension Set Entry]` o solo `[Posted Document Dimension]`?

---

### QRY_010 — NoteCreditoESconti (fab02-NoteCreditoESconti-step02)

**Nome Access:** `fab02-NoteCreditoESconti-step02`
**Tipo:** Select
**Usata in:** Report `fab02-NoteCreditoESconti-step02`
**Complessità:** Alta — struttura identica a QRY_009

**Scopo business:**
Analogo di QRY_009 per le note di credito. Dettaglio note credito per cliente/marchio/periodo con sconti.

**Tabelle NAV coinvolte:**
- `[Sales Cr_Memo Line]` / `[Sales Cr_Memo Header]` / `[Customer]` / `[Posted Document Dimension]` (Table ID=115 = Sales Cr Memo Line)

**Note per il porting:**
- Stessa nota di QRY_009 sulla Posted Document Dimension
- WHERE Type = 2 (solo righe articolo)

---

### QRY_011 — VerificaCondizioniSconto (NDCRegistrate-VerificaCondizioniSconto)

**Nome Access:** `NDCRegistrate-VerificaCondizioniSconto`
**Tipo:** Select
**Usata in:** Export manuale
**Complessità:** Media

**Scopo business:**
Identifica le note di credito registrate che contengono righe di tipo testo con la parola "SCO" (condizioni di sconto). Serve per verificare che sulle NDC emesse siano sempre specificate le condizioni di sconto applicate.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `[Sales Cr_Memo Header]` | — | Base |
| `[Sales Cr_Memo Line]` | — | INNER JOIN |

**Parametri:**
- `[Forms]![Principale]![DataIniziale]` → `@DataIniziale DATE`
- `[Forms]![Principale]![DataFinale]` → `@DataFinale DATE`

**Logica chiave:**
- WHERE Type = 0 (righe testo/commento)
- HAVING Description LIKE '*SCO*' e Posting Date nel periodo

---

### QRY_012 — AnalisiCredicoAnomalieOrdini (AnalisiCredito-RicercaAnomalie)

**Nome Access:** `AnalisiCredito-RicercaAnomalie`
**Tipo:** Select
**Usata in:** Export VBA `TastoAnomalieAvanzamento_Click`
**Complessità:** Molto Alta — 30+ campi, dati Cerved/Cribis, parametri multipli

**Scopo business:**
Analisi del rischio credito per ordini di vendita. Per ogni ordine mostra i dati di fido Cerved e Cribis del cliente, le condizioni di pagamento, e flag se l'ordine è stato marcato come anomalo/verificato. Usato dalla direzione crediti.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi chiave |
|---------|-------|-----------|--------------|
| `[Sales Header]` | — | Base | Document Type, Anomalous, Anomalous Date, Checked, Checked Date, Selling Season Code, Payment Method/Terms |
| `[Sales Line]` | — | JOIN | Line Amount, Delete Reason, Currency Code, Document Type |
| `[Customer]` | — | JOIN | Blocked for Assignments, Current Risk, Credit Limit, Risk Rating, Updated Date, Payment Method/Terms |
| `[Geographical Zone]` | — | JOIN | Credit Manager, Description |
| `[Salesperson_Purchaser]` | — | JOIN | Code, Name |

**Parametri:**
- `[forms]![principale]![creditofiltrostagione2]` → `@StagioneDaAnalizzare VARCHAR(10)`

**Logica chiave:**
- `DaVerificare = IF Anomalous=1 AND Checked != 1 THEN 'X'`
- Aggregazione SUM dei valori ordini per stagione filtrata e stagione precedente (per confronto)
- `Val([credit limit])` → i campi Cerved/Cribis in NAV sono stringhe

**Note per il porting:**
- I campi `Anomalous`, `Checked`, `Current Risk`, `Risk Rating` sono campi custom di NewEra su `[Customer]` e `[Sales Header]`
- ⚠️ CHIARIMENTO RICHIESTO: Questi campi custom sono ancora presenti nel NAV attuale (FEBOS_10)?

---

### QRY_013 — TempiPagamento (tempiPagQueryDefinitiva)

**Nome Access:** `tempiPagQueryDefinitiva`
**Tipo:** Select
**Usata in:** Report `reportTempiPagamento`
**Complessità:** Alta — calcolo giorni pagamento con soglie configurabili

**Scopo business:**
Per ogni documento di pagamento abbinato a una fattura, calcola i giorni effettivi di pagamento e i giorni di ritardo rispetto alla scadenza. Confronta con soglie configurabili dall'utente per classificare i pagamenti.

**Tabelle NAV coinvolte (via step1):**
- `[Cust_ Ledger Entry]` — fatture e pagamenti
- `[Detailed Cust_ Ledg_ Entry]` — abbinamenti pagamento/fattura

**Parametri:**
- `[forms]![principale]![NumeroGiorniSoglia]` → `@SogliaGiorni INT`
- `[forms]![principale]![NumeroGiorniSogliaRitardo]` → `@SogliaRitardo INT`

**Logica chiave:**
- `giorniPagamento = DATEDIFF('d', datafattura, datapagamento)` → `DATEDIFF(day, ...)`
- `giorniritardoPagamento = DATEDIFF('d', datascadenzapagamento, datapagamento)`
- `importoEntroSoglia = IF giorniPagamento <= @SogliaGiorni THEN importo ELSE 0`

---

### QRY_014 — ControlloBancariRiba (ControlloCCBancariRiba)

**Nome Access:** `ControlloCCBancariRiba`
**Tipo:** Select
**Usata in:** Export VBA `TastoCCBancariERiba_Click`
**Complessità:** Media

**Scopo business:**
Identifica gli ordini di vendita con metodo di pagamento RIBA che non hanno coordinate bancarie associate (ABI/CAB mancanti o IBAN vuoto). Usato per verificare che tutti gli ordini RIBA abbiano un CC valido prima della fatturazione.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `[Sales Header]` | — | Base |
| `[Customer Bank Account]` | — | LEFT JOIN (su Customer No_ + Bank Account code) |

---

### QRY_015 — InventarioGiornaliero (InventarioAllaData-PerGiacenzaGiornaliera)

**Nome Access:** `InventarioAllaData-PerGiacenzaGiornaliera`
**Tipo:** Procedure (INSERT parametrico)
**Usata in:** VBA `TastoAndamentoInventario_Click` — chiamata in loop per ogni giorno del periodo
**Complessità:** Alta — INSERT selettivo, configuratore articolo = 3

**Scopo business:**
Inserisce nella tabella locale `inventarioAndamento` la giacenza cumulata per marchio/stagione/locazione a una data specifica. Viene chiamato iterativamente per costruire la serie storica giornaliera delle giacenze.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `[Item Ledger Entry]` | — | Base | No_, Quantity, Posting Date |
| `[Item]` | — | INNER JOIN | Trademark Code, Season Code, Advertising Material, Configurator Relation |

**Parametri:**
- `[Inventory_Date]` → `@DataInventario DATE`

**Logica chiave:**
- WHERE `Posting Date <= @DataInventario` — cumulata storica
- WHERE `Advertising Material = 0` — esclude campionari
- HAVING `Configurator Relation = 3` — filtra solo articoli "normali" (non varianti configurate)
- HAVING `SUM(Quantity) != 0` — esclude locazioni con giacenza zero

**Note per il porting:**
- In Luke non usare un INSERT loop — calcolare la serie storica in una singola query con `CROSS JOIN` su date o con una date series CTE
- ⚠️ Il valore `Configurator Relation = 3` è specifico di NewEra — verificare significato con business

---

### QRY_016 — GiacenzaAssortimenti (GiacenzaAssortimenti)

**Nome Access:** `GiacenzaAssortimenti`
**Tipo:** Select
**Usata in:** Analisi disponibilità
**Complessità:** Media

**Scopo business:**
Giacenza corrente per assortimento, colore e locazione. Punto di partenza per le analisi di disponibilità e allocazione.

**Tabelle NAV coinvolte:**
- `[Assortment Ledger Entry]` / `[Assortment Quantity]`

---

### QRY_017 — AnalisiConsegneAcquisti (AnalisiDateConsegna)

**Nome Access:** `AnalisiDateConsegna`
**Tipo:** Select
**Usata in:** Export VBA `TastoAndamentoConsegneAcquisti_Click`
**Complessità:** Alta

**Scopo business:**
Analisi dello scostamento tra data prevista e data effettiva di consegna acquisti per articolo. Permette di monitorare i ritardi dei fornitori per stagione.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `AnalisiDateConsegna-Union` | — | Base |
| `[Purchase Header]` | — | INNER JOIN | Order Date, Buy-from Vendor No_ |
| `[Vendor]` | — | INNER JOIN | Name (fornitore) |
| `[Vendor]` | Vendor_1 | LEFT JOIN | Name (produttore/manufacturer) |

---

### QRY_018 — AnalisiConsegneVendite (AnalisiDateConsegnaVendite)

**Nome Access:** `AnalisiDateConsegnaVendite`
**Tipo:** Select
**Usata in:** Export VBA `TastoAndamentoConsegneVendite_Click`
**Complessità:** Alta — classifica tipo ordine con IIF annidati

**Scopo business:**
Analisi date di consegna per ordini di vendita con classificazione del tipo ordine (Programmato, Riassortimento, Pronto, Stock, Sostituzione, Pre-Season, Commerciale).

**Logica chiave:**
```
OrderType = IIF(order_type=1, 'Riass.', IIF(=2,'Pronto', IIF(=3,'Stock',
            IIF(=4,'Sost.', IIF(=0,'Progr', IIF(=5,'PreSeason',
            IIF(=17,'Commerciale','?')))))))
```
In T-SQL: CASE WHEN con sette WHEN. I valori numerici corrispondono a valori dell'enum `Order Type` in NAV NewEra.

---

### QRY_019 — VenditeEPrenotazioni

**Nome Access:** `VenditeEPrenotazioni`
**Tipo:** Select (wrapper)
**Usata in:** Export VBA `TastoAnalisiPortafoglioEPrenotazioni_Click`
**Complessità:** Alta

**Scopo business:**
Portafoglio ordini attivi aggregato con le prenotazioni di trasferimento e le giacenze disponibili. Permette di vedere quante paia sono vendute, spedite, prenotate e disponibili per ogni articolo/stagione.

---

### QRY_020 — EstrazioneOrdiniCostoEXW (EstrazioneOrdiniVenditaCostoEXWFOB)

**Nome Access:** `EstrazioneOrdiniVenditaCostoEXWFOB`
**Tipo:** Select
**Usata in:** Export VBA `TastoCalcoloEXW_Click` (filtro per singolo ODV)
**Complessità:** Alta — calcolo costo totale per riga d'ordine

**Scopo business:**
Per un ordine di vendita specifico, calcola per ogni riga il valore venduto e il costo EXW/FOB totale (costo acquisto × paia vendute). Usato per analisi di marginalità per singolo ordine.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `[Sales Header]` | — | Base |
| `[Sales Line]` | — | INNER JOIN |
| `ItemMasterData_EXWFOB_step0` | — | LEFT JOIN | Costo unitario EXW/FOB per articolo/colore |

**Parametri:**
- `[Forms]![Principale]![FiltroODVCalcoloEXW]` → `@NumeroOrdineVendita VARCHAR(20)`

**Logica chiave:**
- `TotCosto = SUM(PairsSold * CostoUnitario)`
- `ValueSold = SUM(IIF(Document Type=1, LineAmount - InvDisc, -(LineAmount - InvDisc)))` — gestisce sia ordini (type=1) che note credito (type negativo)

---

### QRY_021 — AnalisiPosizionamento

**Nome Access:** `AnalisiPosizionamento`
**Tipo:** Select
**Usata in:** Export VBA `TastoAnalisiPosizionamento_Click`
**Complessità:** Alta — paia confermate con prezzi wholesale e retail

**Scopo business:**
Analisi del posizionamento degli articoli venduti per taglia, con prezzi wholesale e retail. Usato per verificare la coerenza dei prezzi e la distribuzione delle taglie vendute.

**Tabelle NAV coinvolte:**
| Tabella | Join |
|---------|------|
| `[Sales Line]` | Base |
| `[Item]` | INNER JOIN |
| `[Vendor]` | LEFT JOIN |
| `[Variable Code]` | INNER JOIN |
| `AnalisiPosizionamentoRetailPrice` | LEFT JOIN |
| `AnalisiPosizionamentoWholeSalePrice` | LEFT JOIN |

**Logica chiave:**
- `PaiaConfermate = SUM(IIF(delete_reason = '' OR IS NULL, Val(quantity), 0))`
- Prezzi retail e wholesale vengono aggiunti solo se la riga di listino esiste (IIF IS NULL)

---

### QRY_022 — BilancioPerSorgente

**Nome Access:** `BilancioPerSorgente`
**Tipo:** Select
**Usata in:** Export VBA `TastoBilancioPerSorgente_Click`
**Complessità:** Alta — CoGe con dimensioni

**Scopo business:**
Estrae i movimenti di contabilità generale per conti che iniziano con "R" (ricavi), arricchiti con le dimensioni (CCR, Marchio, Stagione, Linea) e i nomi di clienti/fornitori associati. Usato per la riconciliazione del fatturato contabile con le statistiche commerciali.

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type |
|---------|-------|-----------|
| `[G_L Entry]` | — | Base | Source Code, Source Type, Source No_, Amount, Posting Date, Dimension Set ID, G_L Account No_ |
| `[G_L Account]` | — | LEFT JOIN | Name |
| `[Vendor]` | — | LEFT JOIN | Name |
| `[Customer]` | — | LEFT JOIN | Name |
| `Dimensioni_NE` | — | LEFT JOIN | CCR, Marchio, Stagione, Linea (vista custom su Dimension Set Entry) |

**Parametri:**
- `@DataIniziale DATE` / `@DataFinale DATE` (filtro applicato nel WHERE)

---

### QRY_023 — AssortimentiQuantita

**Nome Access:** `AssortimentiQuantita`
**Tipo:** Select
**Usata in:** Analisi assortimenti
**Complessità:** Bassa

**Scopo business:**
Quantità totali per assortimento e gruppo variabili. Base per il dimensionamento degli assortimenti.

---

### QRY_024 — ListinoWholesale (ListinoVenditaWholesaleRaggruppato)

**Nome Access:** `ListinoVenditaWholesaleRaggruppato`
**Tipo:** Select
**Usata in:** `GraficoMiglioriArticoliVenduti`, `AnalisiPosizionamento`
**Complessità:** Media — usa funzione VBA custom `append()`

**Scopo business:**
Listino prezzi wholesale per articolo/colore, con tutti i listini applicabili concatenati in una stringa. Gestisce il caso in cui ci siano più listini per lo stesso articolo (es: per valuta diversa).

**Note per il porting:**
- La funzione `append()` è una funzione VBA custom che concatena valori con separatori — in T-SQL usare `STRING_AGG(FORMAT(listino, 'N2'), ',')`
- ⚠️ La tabella sorgente è `[CFG Variant]` o `[Sales Price]` — verificare

---

### QRY_025 — CarichiNegozioOutlet

**Nome Access:** `CarichiNegozioOutletDaDdt`
**Tipo:** Select
**Usata in:** Analisi movimenti negozio outlet
**Complessità:** Media

**Scopo business:**
Estrae i carichi del negozio outlet da DDT, con EAN code, per monitorare i movimenti di merce verso il canale outlet.

**Parametri:**
- `[Forms]![Principale]![FiltroDDTPerNegozioOutlet]` → `@NumeroDDT VARCHAR(20)`

---

### QRY_026 — StatusDDT (WMS_AnalisiStatusDDT)

**Nome Access:** `WMS_AnalisiStatusDDT`
**Tipo:** Select
**Usata in:** Export VBA `TastoAnalisiDDTSpedizioniWarehouse_Click`
**Complessità:** Bassa (aggregazione di un detail)

**Scopo business:**
Riepilogo del numero di DDT per combinazione di status DDT e status warehouse. Usato per monitorare i DDT in sospeso, aperti, rilasciati.

---

### QRY_027 — SpedizioniWarehouse (WMS_WarehouseShipment)

**Nome Access:** `WMS_WarehouseShipment`
**Tipo:** Select
**Usata in:** Export VBA `TastoAnalisiSpedizioniWarehouse_Click`
**Complessità:** Media

**Scopo business:**
Dettaglio delle spedizioni warehouse con status box (Item Identifier). Usato dal magazzino per il controllo delle spedizioni in corso.

---

### QRY_028 — AnalisiNoteCredito (def01-ANALISINOTEDICREDITO-PIVOT)

**Nome Access:** `def01-ANALISINOTEDICREDITO-PIVOT`
**Tipo:** Select
**Usata in:** VBA `TastoAnalisiNoteDiCreditoEResi_Click`
**Complessità:** Alta — arricchisce le NDC con classificazione articolo completa

**Scopo business:**
Analisi completa delle note di credito e resi con classificazione articolo (Product Family, Product Sex, Season Typology, Innovation Degree, Market Segment, ecc.). Permette di capire il motivo e il pattern dei resi.

**Tabelle NAV coinvolte:**
- `qAnalisiNoteDiCreditoEResi-step1` — base NDC + resi
- `[Item]` — INNER JOIN per tutti gli attributi di classificazione
- `[Geographical Zone]` — LEFT JOIN per zona geografica

---

## Moduli VBA

### VBA — Form_Principale

**Tipo:** Document Module
**Responsabilità:** Dashboard centrale, gestione di tutti gli export Excel, parametrizzazione dinamica delle query, gestione multi-company

**Funzioni/Sub rilevanti per il porting:**
| Nome | Scopo | Logica da replicare in Luke |
|------|-------|----------------------------|
| `EstrazioneStatisticheGenericaPerStagione` | Crea query temporanea, inietta filtro stagione/marchio, esporta Excel | API endpoint con filtri stagione+marchio → stream Excel |
| `TastiEstrazioneProiezioneVendutoComprato_Click` | Popola tabella staging venduto/comprato, rimuove duplicati, esporta | Endpoint dedicato: calcola VendutoComprato, deduplicazione, download |
| `TastoAndamentoInventario_Click` | Loop giornaliero per costruire serie storica giacenze | Query SQL con date series CTE (no loop) |
| `TastoAnalisiFatturato_Click` | Apre report fatturato con filtro date | Endpoint con @DataInizio / @DataFine |
| `TastoAnnullamentiPerAgente_Click` | Apre report annullamenti filtrato per marchio/stagione/agente | Endpoint con @Marchio + @Stagione + @CodiceAgente |
| `TastoAnalisiPosizionamento_Click` | Export posizionamento per marchio/stagione | Endpoint con @Marchio + @Stagione |
| `TastoCalcoloEXW_Click` | Export costo EXW per singolo ODV | Endpoint con @NumeroOrdine |
| `collegaTabelle` | Ricollegamento tabelle ODBC al cambio azienda | Non necessario in Luke (connessione fissa a NAV) |
| `sistemaFiltroStagioneMarchio` | Costruisce stringa WHERE dinamica per filtri multi-stagione | Gestire lato API con array di parametri |
| `sistemaquerysolostagionaleepronto` | Swappa SQL della query base (filtro tipi ordine) | Flag API: soloStagionaleEPronto / soloRiassortimento / tutti |

**Parametri intercettati (input utente dal Form Principale):**
| Campo | Tipo | Usato in |
|-------|------|----------|
| `DataIniziale` / `DataFinale` | Date | Fatturato, NDC, Tempi pagamento, Inventario |
| `FiltroStagioneMultiSelezione` | Listbox multi | Export analisi venduto, confronto stagioni |
| `FiltroMarchioMultiSelezione` | Listbox | Export analisi venduto |
| `FiltroMarchio` / `FiltroStagione` | TextBox | Andamento vendite, Posizionamento, Annullamenti |
| `FiltroAgente` | TextBox | Annullamenti per agente |
| `FattoreCorrettivo` | Numeric | Proiezione VendutoComprato |
| `cambioeurodollaro` | Numeric | Conversione valuta acquisti USD/EUR |
| `FiltroMarchioSourcing` / `FiltroStagioneSourcing` | TextBox | Export proiezione VendutoComprato |
| `filtroconfrontostagione1/2` + `datacutoffstagione1/2` | TextBox + Date | Confronto stagioni avanzato |
| `CreditoFiltroStagione2` | TextBox | Analisi anomalie credito |
| `NumeroGiorniSoglia` / `NumeroGiorniSogliaRitardo` | Numeric | Analisi tempi pagamento |
| `FiltroODVCalcoloEXW` | TextBox | Estrazione costo EXW per ODV |
| `FiltroDDTPerNegozioOutlet` | TextBox | Carichi negozio outlet |
| `FiltroODVEAN` / `FiltroClienteEAN` / `FiltroStagioneEAN2` | TextBox | Estrazione EAN per cliente/stagione |
| `PercorsoSalvataggio` | TextBox (da tabella) | Percorso base file Excel esportati |

**Pattern export comune:**
```vba
exportFileName = nomeAzienda & "-" & nomeReport & "-" & YYYYMMDD & "-" & HHMM & "-(" & FiltriApplicati & ")"
exportFileName = PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, nomeQuery, exportFileName, True
```
In Luke: sostituire con `res.setHeader('Content-Disposition', 'attachment; filename=...')` + streaming XLSX via `exceljs`.

---

### VBA — Form_Login

**Tipo:** Document Module
**Responsabilità:** Autenticazione locale e selezione azienda

**Punti rilevanti:**
- L'azienda è hardcoded a "NewEra" dalla versione 19.0 (variabile `nomeAzienda`)
- Il DSN ODBC viene ricavato dal nome azienda nella funzione `collegaTabelle`
- Credenziali hardcoded per superadmin (non portare)
- Livello utente (0-N) controlla accesso a funzioni avanzate (es. TastoAggiornaLinks richiede livello >= 3)

**Non portare in Luke:** il sistema di autenticazione è già gestito da Luke Auth. Il concetto di `livelloUtente` si mappa sui ruoli Luke (`admin`, `editor`, `viewer`).

---

### VBA — Modulo Standard (funzioni utility)

**Funzioni rilevanti:**
| Nome | Scopo | Equivalente in Luke |
|------|-------|---------------------|
| `append(a, ID, taglio)` | Concatenazione multipla valori con memo (simile GROUP_CONCAT) | `STRING_AGG()` in T-SQL |
| `restituisciDataComeStringa(d)` | Converte data italiana → formato MM/DD/YYYY per query Access | Non necessario in T-SQL |
| `collegaTabelle(source, db, prefix)` | Ricollegamento ODBC tables | Non necessario in Luke |
| `UPC_A(barcode)` | Calcolo check digit EAN/UPC | Utility separata se necessario |

---

## Note per il porting a Luke

### Architettura consigliata

1. **Livello dati:** Le query T-SQL documentate vengono trasformate in `tRPC` procedures nel router `apps/api/src/routers/statistics.ts`
2. **Parametri:** I parametri `[Forms]![principale]![campo]` diventano input dello schema Zod del tRPC procedure
3. **Export Excel:** Usare `exceljs` (già noto nel progetto Luke) al posto di `DoCmd.TransferSpreadsheet`
4. **Tabelle locali Access:** Le tabelle LOCALE (non ODBC) come `inventarioAndamento`, `VendutoCompratoProiezioneTabella` diventano tabelle Prisma temporanee o calcoli in-memory
5. **Stagione corrente:** Il filtro stagione/marchio è sempre richiesto — non eseguire mai le query statistiche senza filtro stagione (performance)

### Dipendenze non-NAV da valutare

| Tabella Access | Tipo | Contenuto | Decisione |
|----------------|------|-----------|-----------|
| `DatiCarryOverESMU` | LOCALE | Carry Over / SMU per articolo | Verificare se dato è in NAV o va ricreato |
| `Fornitori` | MS Access DB | Dati commerciali fornitori (cambio, commissioni, dogane) | Già presente in Luke PricingParameterSet? |
| `Marchi` | MS Access DB | % sconti, royalties, provvigioni per marchio | Già presente in Luke? |
| `DatiCommercialiClienti` | MS Access DB | Punti vendita, distribuzione, resi per cliente | Non in Luke — valutare creazione |
| `Budget` | Text/CSV | Budget vendite | Non in NAV — da importare |
| `inventarioAndamento` | LOCALE | Serie storica giacenze giornaliere | Calcolare on-demand con CTE |

### Nota su date NAV

In NAV Business Central (e NAV 2013), la "data nulla" per i campi date è `1753-01-01` (01/01/1753). In tutte le query che filtrano `delete_date = #1/1/1753#` tradurre in T-SQL come:
```sql
AND (delete_date = '1753-01-01' OR delete_date IS NULL)
```
