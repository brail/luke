SELECT [AnalisiCredito-RicercaAnomalie-NoteOrdiniCommercialeStep1].NumeroOrdine, Last([AnalisiCredito-RicercaAnomalie-NoteOrdiniCommercialeStep1].commenti) AS listacommenti
FROM [AnalisiCredito-RicercaAnomalie-NoteOrdiniCommercialeStep1]
GROUP BY [AnalisiCredito-RicercaAnomalie-NoteOrdiniCommercialeStep1].NumeroOrdine;

