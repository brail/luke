SELECT tempiPag_New_step4_CalcoloDelloImportoPerEnrtyNo.[Entry No_], tempiPag_New_step4_CalcoloDelloImportoPerEnrtyNo.Importo, tempiPag_New_step4_CalcoloDelloImportoPerEnrtyNo.ImportoResiduo, [importo]-[importoresiduo] AS importototalePagatoPerEntryNo, IIf([importototalePagatoPerEntryNo]=0,"FullOpen",IIf([importoresiduo]<>0,"Partial","Payed")) AS status
FROM tempiPag_New_step4_CalcoloDelloImportoPerEnrtyNo;

