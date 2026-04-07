SELECT "SELL" as SourceType, No_, [Constant Variable Code], PairsSold as Pairs, ForecastedPairsByMarket_, ForecastedPairsByMarketCorrected_, ForecastedPairsFlat
FROM [VendutoCompratoProiezioneItem-step6-VenditeProiettate];

Union all select "BUY" as SourceType, No_, [Constant Variable Code], PairsPurchased as Pairs, 0,0,0
FROM [VendutoCompratoProiezioneItem-step8-CompratoByAricoloColore]

UNION ALL select "INVENTORY" as SourceType, No_, [Variable Code 01], PairsInventory as Pairs, 0,0,0
FROM [VendutoCompratoProiezioneItem-step8-bis-giacenza];

