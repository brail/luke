SELECT RicercaperBollofatturazioneeltrronicadifferenze.[Document No_], RicercaperBollofatturazioneeltrronicadifferenze.IMPORTO, "PDC" AS tipoorigine, [DOCUMENT TYPE]
FROM RicercaperBollofatturazioneeltrronicadifferenze;

UNION ALL select no_, importo, "FATTNDC", DOCTYPE as tipoorigine from RicercaPerBolloFatturazioneElettronica;

