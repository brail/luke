SELECT [AnalisiCredito-RicercaAnomalie-NoteOrdiniCreditoStep1].NumeroOrdine, Last([AnalisiCredito-RicercaAnomalie-NoteOrdiniCreditoStep1].commenti) AS listacommenti
FROM [AnalisiCredito-RicercaAnomalie-NoteOrdiniCreditoStep1]
GROUP BY [AnalisiCredito-RicercaAnomalie-NoteOrdiniCreditoStep1].NumeroOrdine;

