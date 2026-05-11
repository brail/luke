SELECT [AnalisiCredito-RicercaAnomalie].[Sell-to Customer No_], [AnalisiCredito-RicercaAnomalie].MetodoPagamentoOrdine, [AnalisiCredito-RicercaAnomalie].CondizioniPagamentoOrdine
FROM [AnalisiCredito-RicercaAnomalie]
GROUP BY [AnalisiCredito-RicercaAnomalie].[Sell-to Customer No_], [AnalisiCredito-RicercaAnomalie].MetodoPagamentoOrdine, [AnalisiCredito-RicercaAnomalie].CondizioniPagamentoOrdine;

