SELECT [qAcqPerPaiaRicevute-step0].No_ AS PurchasesArt, [qAcqPerPaiaRicevute-step0].[Constant Variable Code] AS PurchasesColorCode, [qAcqPerPaiaRicevute-step0].[Assortment Code] AS PurchasesAssortment, Sum(Val([Quantity])) AS PurchasesAssortimentQuantity, Sum(Val([No_ of Pairs])) AS PurchasesPairs, Sum([qAcqPerPaiaRicevute-step0].ReceivedPairs) AS ReceivedPairs
FROM [qAcqPerPaiaRicevute-step0]
GROUP BY [qAcqPerPaiaRicevute-step0].No_, [qAcqPerPaiaRicevute-step0].[Constant Variable Code], [qAcqPerPaiaRicevute-step0].[Assortment Code];

