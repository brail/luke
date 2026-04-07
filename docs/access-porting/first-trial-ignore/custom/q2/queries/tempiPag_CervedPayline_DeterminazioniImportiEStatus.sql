SELECT tempiPag_CervedPayline_DeterminazioniImporti.ChiaveMovimentoFatturaNotaCredito, tempiPag_CervedPayline_DeterminazioniImporti.importototalePagatoPerEntry, tempiPag_CervedPayline_DeterminazioniImporti.ImportoOriginalePerEntry, IIf([importototalePagatoPerEntry]=0,"FullOpen",IIf(Abs([importototalePagatoPerEntry]-[importooriginaleperentry])>0.0001,"Partial","Payed")) AS status
FROM tempiPag_CervedPayline_DeterminazioniImporti;

