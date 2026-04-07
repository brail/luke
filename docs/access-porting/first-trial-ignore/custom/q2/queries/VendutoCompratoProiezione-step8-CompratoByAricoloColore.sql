SELECT [VendutoCompratoProiezione-step7-Comprato].No_, [VendutoCompratoProiezione-step7-Comprato].[Constant Variable Code], Sum([VendutoCompratoProiezione-step7-Comprato].PairsPurchased) AS PairsPurchased
FROM [VendutoCompratoProiezione-step7-Comprato]
GROUP BY [VendutoCompratoProiezione-step7-Comprato].No_, [VendutoCompratoProiezione-step7-Comprato].[Constant Variable Code];

