SELECT [VendutoCompratoProiezione-step9-new].No_, [VendutoCompratoProiezione-step9-new].[Constant Variable Code], Sum(IIf([sourcetype]="SELL",[PAIRS],0)) AS PairsSold, Sum(IIf([sourcetype]="BUY",[PAIRS],0)) AS PairsPurchased, Sum(IIf([sourcetype]="INVENTORY",[PAIRS],0)) AS PairsInventory, Sum([VendutoCompratoProiezione-step9-new].ForecastedPairsByMarket_) AS ForecastedPairsByMarket_, Sum([VendutoCompratoProiezione-step9-new].ForecastedPairsByMarketCorrected_) AS ForecastedPairsByMarketCorrected_, Sum([VendutoCompratoProiezione-step9-new].ForecastedPairsFlat) AS ForecastedPairsFlat
FROM [VendutoCompratoProiezione-step9-new]
GROUP BY [VendutoCompratoProiezione-step9-new].No_, [VendutoCompratoProiezione-step9-new].[Constant Variable Code];

