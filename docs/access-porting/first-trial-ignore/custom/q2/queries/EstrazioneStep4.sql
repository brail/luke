SELECT EstrazioneStep3.*, [codice_materiale_colore] & "_" & IIf([type]="simple","1","2") & "_" & [sku] AS sorting_key
FROM EstrazioneStep3
ORDER BY [codice_materiale_colore] & "_" & IIf([type]="simple","1","2") & "_" & [sku];

