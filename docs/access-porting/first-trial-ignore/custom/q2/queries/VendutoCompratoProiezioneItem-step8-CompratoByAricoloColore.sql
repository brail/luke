SELECT [VendutoCompratoProiezioneItem-step7-Comprato].No_, [VendutoCompratoProiezioneItem-step7-Comprato].[Constant Variable Code], Sum([VendutoCompratoProiezioneItem-step7-Comprato].PairsPurchased) AS PairsPurchased
FROM [VendutoCompratoProiezioneItem-step7-Comprato]
GROUP BY [VendutoCompratoProiezioneItem-step7-Comprato].No_, [VendutoCompratoProiezioneItem-step7-Comprato].[Constant Variable Code];

