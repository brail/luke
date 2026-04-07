SELECT [VendutoCompratoProiezione-Vendite-step0].No_, [VendutoCompratoProiezione-Vendite-step0].[Constant Variable Code], Sum([VendutoCompratoProiezione-Vendite-step0].PairsSold) AS TotalPairsByArticleColor
FROM [VendutoCompratoProiezione-Vendite-step0]
GROUP BY [VendutoCompratoProiezione-Vendite-step0].No_, [VendutoCompratoProiezione-Vendite-step0].[Constant Variable Code];

