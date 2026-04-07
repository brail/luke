SELECT No_, [Constant Variable Code], PairsSold, PairsPurchased, ForecastedPairsByMarket_, ForecastedPairsByMarketCorrected_, ForecastedPairsFlat, toBuy, toSell, toBuyByBudgetCorrected, toSellByBudgetCorrected, toBuyFlat, toSellFlat
FROM [VendutoCompratoProiezione-step9-BOTH];

UNION ALL SELECT No_, [Constant Variable Code], PairsSold, PairsPurchased, ForecastedPairsByMarket_, ForecastedPairsByMarketCorrected_, ForecastedPairsFlat, toBuy, toSell, toBuyByBudgetCorrected, toSellByBudgetCorrected, toBuyFlat, toSellFlat
FROM [VendutoCompratoProiezione-step9-SOLOvEND];

UNION ALL SELECT No_, [Constant Variable Code], PairsSold, PairsPurchased, ForecastedPairsByMarket_, ForecastedPairsByMarketCorrected_, ForecastedPairsFlat, toBuy, toSell, toBuyByBudgetCorrected, toSellByBudgetCorrected, toBuyFlat, toSellFlat
FROM [VendutoCompratoProiezione-step9-SOLOACQ];

