SELECT [AnalisiCredito-RicercaAnomalie-NoteOrdiniAltroStep1].NumeroOrdine, Last([AnalisiCredito-RicercaAnomalie-NoteOrdiniAltroStep1].commenti) AS listacommenti
FROM [AnalisiCredito-RicercaAnomalie-NoteOrdiniAltroStep1]
GROUP BY [AnalisiCredito-RicercaAnomalie-NoteOrdiniAltroStep1].NumeroOrdine;

