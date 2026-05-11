# Analisi Query — NewEraStat.accdb

## 📊 Statistiche Generali

- **Query totali:** 1111
- **Query visibili:** 1106
- **Query nascoste:** 0
- **Query sistema:** 5
- **NAV-correlate:** 969
- **Tabelle temporanee:** 53

## 📈 Distribuzione Complessità

- **Bassa:** 1011
- **Media:** 95
- **Alta:** 5

## 🗄️ Tabelle NAV Referenziate


## 📋 Query per Categoria

### Query NAV-correlate (principale focus porting)

- **qSoloVendNoFiltr-STEP0** — Alta, 10948 chars
- **def01-ANALISIVENDUTO-PIVOT-step0** — Media, 10803 chars
- **qSoloVendItemConFiltroAgente** — Media, 9176 chars
- **qSoloVendItem** — Media, 9143 chars
- **qSoloVendItemConFiltroCliente** — Media, 9143 chars
- **qSoloVendItemPerEan** — Media, 9137 chars
- **qSoloVendConFiltroCliente** — Media, 8995 chars
- **qSoloVendConFiltroAgente** — Media, 8990 chars
- **qSoloVendItemNoFiltri** — Media, 8846 chars
- **qSoloVend-step1** — Bassa, 8547 chars
- **qsolovenditemPerEan-step1** — Bassa, 8307 chars
- **dam_cancellazione blocco ddt righe_parte 1** — Bassa, 7884 chars
- **qSoloVendItem-step1** — Bassa, 7163 chars
- **dam_cancellazione blocco ddt testate_parte 1** — Bassa, 6871 chars
- **AnalisiCredito-RicercaAnomalie** — Media, 5968 chars
- **dam_cancellazione blocco ddt righe_parte 2** — Bassa, 5554 chars
- **def01-StimaRedditivitaFineStagioneVendite-PIVOT** — Bassa, 5219 chars
- **def01-StimaRedditivitaFineStagioneVendite** — Bassa, 4889 chars
- **EstrazioneStep1** — Media, 4779 chars
- **dam_cancellazione blocco ddt testate_parte 2** — Bassa, 4638 chars

### Query di Sistema (interne, ~ prefix)

- ~sq_rMiglioriArticoliVenduti-LineaModello-VendutoComprato
- ~sq_rReportOK
- ~sq_rReportOkSovraccolliDaLetture_TJX
- ~sq_rreporttjx
- ~sq_rReportTJXManuali

## 🔗 Dipendenze Query

Query con dipendenze: 509/
1111

- **GraficoMiglioriArticoliVenduti** → GraficoMiglioriArticoliVenduti-step2, DatiCarryOverESMU, GraficoMiglioriArticoliVenduti-step1
- **GraficoMiglioriArticoliVenduti-Fornitore** → GraficoMiglioriArticoliVenduti-step2, DatiCarryOverESMU, GraficoMiglioriArticoliVenduti
- **VenditeEPrenotazioniUnioneStatus** → UNION, VenditeEPrenotazioni-Scoperto, VenditeEPrenotazioni
- **CalcoloDisponibilita-step1** → UNION, CalcoloDisponibilita-step0-GiacenzaAssortimenti, CalcoloDisponibilita-step0-AcquistiNetti
- **OrdiniCLienteItem** → NavisionEan-step0, DatiCarryOverESMU, ListinoVenditaRetail
- **VenditeEPrenotazioni-CalcoloTotaleCoperto-step0** → UNION, VenditeEPrenotazioni-Spedito, VenditeEPrenotazioni
- **CalcoloDisponibilitaItem-step1** → UNION, CalcoloDisponibilitaItem-step0-TrasferimentiNetti, CalcoloDisponibilitaItem
- **VenditeEPrenotazioni-CalcoloTotaleCoperto-step0_OLD** → UNION, VenditeEPrenotazioni-Spedito, VenditeEPrenotazioni
- **CreditoGrigliaAgenti** → CreditoGrigliaAgenti-step0, AnalisiCredito-step1-datiSaldoClienti, AnalisiCredito
- **def01-ANALISIVENDUTO-PIVOT-step0** → CrossReferenceCliente, DatiCarryOverESMU, MustBuy-ArticoloColore

---

## 🎯 Raccomandazioni Porting

### MVP (Priorità Alta)

Iniziare dalle 5-10 query NAV-correlate che coprono:
- Sales Shipment Line (vendite)
- Purchase (acquisti)
- Items (articoli)
- Customers (clienti)
- Ledger entries (registri)

### Fase 2: Query di Sistema

Query interne (~sq_*) sono ottimizzate per Access.
Potrebbero essere semplificate per SQL Server nativo.

### Fase 3: Report e Dashboard

Tabelle temporanee (tabelleappoggio) usate per cache intermedi.
In Luke: migrare a materialized views o cache Redis.
