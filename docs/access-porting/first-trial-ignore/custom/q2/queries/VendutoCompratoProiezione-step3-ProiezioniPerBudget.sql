SELECT [VendutoCompratoProiezione-Vendite-step0].[Budget No_], [VendutoCompratoProiezione-Vendite-step0].No_, [VendutoCompratoProiezione-Vendite-step0].[Constant Variable Code], Sum([VendutoCompratoProiezione-Vendite-step0].PairsSold) AS PairsSold_, Sum([PairsSold])*Max([fattoreproiezionedibudget]) AS PairsForecastByBudget, Sum([PairsSold])*Max([fattoreproiezioneGlobale]) AS PairsForecastGlobal
FROM [VendutoCompratoProiezione-Vendite-step0] INNER JOIN VendutoComprato_FattoriDiPropiezione ON [VendutoCompratoProiezione-Vendite-step0].[Budget No_] = VendutoComprato_FattoriDiPropiezione.BudgetNo_
GROUP BY [VendutoCompratoProiezione-Vendite-step0].[Budget No_], [VendutoCompratoProiezione-Vendite-step0].No_, [VendutoCompratoProiezione-Vendite-step0].[Constant Variable Code];

