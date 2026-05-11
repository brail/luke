SELECT [AnalisiCredito-RicercaAnomalie-NoteOrdiniStep1].NumeroOrdine, Last([AnalisiCredito-RicercaAnomalie-NoteOrdiniStep1].commenti) AS listacommenti
FROM [AnalisiCredito-RicercaAnomalie-NoteOrdiniStep1]
GROUP BY [AnalisiCredito-RicercaAnomalie-NoteOrdiniStep1].NumeroOrdine;

