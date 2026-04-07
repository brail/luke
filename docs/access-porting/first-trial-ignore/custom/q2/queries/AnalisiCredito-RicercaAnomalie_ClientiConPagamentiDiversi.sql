SELECT [AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi_step0].[Sell-to Customer No_], Count([AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi_step0].[Sell-to Customer No_]) AS [ConteggioDiSell-to Customer No_]
FROM [AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi_step0]
GROUP BY [AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi_step0].[Sell-to Customer No_]
HAVING (((Count([AnalisiCredito-RicercaAnomalie_ClientiConPagamentiDiversi_step0].[Sell-to Customer No_]))>1));

