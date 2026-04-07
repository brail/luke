SELECT [VendutoCompratoProiezioneItem-Vendite-step0].No_, [VendutoCompratoProiezioneItem-Vendite-step0].[Constant Variable Code], Sum([VendutoCompratoProiezioneItem-Vendite-step0].PairsSold) AS TotalPairsByArticleColor
FROM [VendutoCompratoProiezioneItem-Vendite-step0]
GROUP BY [VendutoCompratoProiezioneItem-Vendite-step0].No_, [VendutoCompratoProiezioneItem-Vendite-step0].[Constant Variable Code];

