SELECT "SELL" as SourceType, No_, [Constant Variable Code], PairsSold as Pairs, ForecastedPairsByMarket_, ForecastedPairsByMarketCorrected_, ForecastedPairsFlat
FROM [VendutoCompratoProiezione-step6-VenditeProiettate];

Union all select "BUY" as SourceType, No_, [Constant Variable Code], PairsPurchased as Pairs, 0,0,0
FROM [VendutoCompratoProiezione-step8-CompratoByAricoloColore]

UNION ALL select "INVENTORY" as SourceType, No_, [Constant Variable Code], PairsInventory as Pairs, 0,0,0
FROM [VendutoCompratoProiezione-step8-bis-giacenza];

