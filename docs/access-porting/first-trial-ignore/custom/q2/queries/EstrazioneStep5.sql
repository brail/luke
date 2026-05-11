SELECT EstrazioneStep4.*, append_associated(IIf([type]="simple",[sku],""),[codice_materiale_colore],1000) AS associated_calc
FROM EstrazioneStep4
ORDER BY EstrazioneStep4.sorting_key;

