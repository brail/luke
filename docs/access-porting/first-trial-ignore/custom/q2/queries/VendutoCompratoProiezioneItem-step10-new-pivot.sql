SELECT [VendutoCompratoProiezioneItem-step9-new].No_, [VendutoCompratoProiezioneItem-step9-new].[Constant Variable Code], Sum(IIf([sourcetype]="SELL",[PAIRS],0)) AS PairsSold, Sum(IIf([sourcetype]="BUY",[PAIRS],0)) AS PairsPurchased, Sum(IIf([sourcetype]="INVENTORY",[PAIRS],0)) AS PairsInventory, Sum([VendutoCompratoProiezioneItem-step9-new].ForecastedPairsByMarket_) AS ForecastedPairsByMarket_, Sum([VendutoCompratoProiezioneItem-step9-new].ForecastedPairsByMarketCorrected_) AS ForecastedPairsByMarketCorrected_, Sum([VendutoCompratoProiezioneItem-step9-new].ForecastedPairsFlat) AS ForecastedPairsFlat
FROM [VendutoCompratoProiezioneItem-step9-new]
GROUP BY [VendutoCompratoProiezioneItem-step9-new].No_, [VendutoCompratoProiezioneItem-step9-new].[Constant Variable Code];

