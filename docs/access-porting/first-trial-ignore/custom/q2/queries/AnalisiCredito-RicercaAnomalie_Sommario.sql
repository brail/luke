SELECT [AnalisiCredito-RicercaAnomalie].[Season Code], [AnalisiCredito-RicercaAnomalie].[Credit Manager], [AnalisiCredito-RicercaAnomalie].[Geographical Zone2 Description], [AnalisiCredito-RicercaAnomalie].Anomalo, [AnalisiCredito-RicercaAnomalie].Verificato, [AnalisiCredito-RicercaAnomalie].DaVerificare, Count([AnalisiCredito-RicercaAnomalie].OrderNo) AS ConteggioDiOrderNo
FROM [AnalisiCredito-RicercaAnomalie]
GROUP BY [AnalisiCredito-RicercaAnomalie].[Season Code], [AnalisiCredito-RicercaAnomalie].[Credit Manager], [AnalisiCredito-RicercaAnomalie].[Geographical Zone2 Description], [AnalisiCredito-RicercaAnomalie].Anomalo, [AnalisiCredito-RicercaAnomalie].Verificato, [AnalisiCredito-RicercaAnomalie].DaVerificare;

