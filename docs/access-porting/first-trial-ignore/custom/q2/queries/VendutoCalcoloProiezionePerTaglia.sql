SELECT [VendutoCalcoloProiezionePerTaglia-step1].TrademarkCode, [VendutoCalcoloProiezionePerTaglia-step1].SeasonCode, [VendutoCalcoloProiezionePerTaglia-step1].ProductGender, [VendutoCalcoloProiezionePerTaglia-step1].size, Sum([VendutoCalcoloProiezionePerTaglia-step1].PairsSold) AS PairsSold, Round(Sum([ForecastedPairsByMarket])) AS ForecastedPairsByMarket_
FROM [VendutoCalcoloProiezionePerTaglia-step1]
GROUP BY [VendutoCalcoloProiezionePerTaglia-step1].TrademarkCode, [VendutoCalcoloProiezionePerTaglia-step1].SeasonCode, [VendutoCalcoloProiezionePerTaglia-step1].ProductGender, [VendutoCalcoloProiezionePerTaglia-step1].size;

