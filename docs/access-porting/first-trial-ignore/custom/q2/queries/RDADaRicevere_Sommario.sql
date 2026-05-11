SELECT RDADaRicevere_Sommario_step0.[season code], RDADaRicevere_Sommario_step0.[Credit Manager], RDADaRicevere_Sommario_step0.GeoZone2Description, Sum(RDADaRicevere_Sommario_step0.PairsSold) AS PairsSold, Sum(RDADaRicevere_Sommario_step0.PairsShipped) AS PairsShipped, Sum(RDADaRicevere_Sommario_step0.ValueSold) AS ValueSold, Sum(RDADaRicevere_Sommario_step0.ValueSoldVAT) AS ValueSoldVAT, RDADaRicevere_Sommario_step0.[Securities Received]
FROM RDADaRicevere_Sommario_step0
GROUP BY RDADaRicevere_Sommario_step0.[season code], RDADaRicevere_Sommario_step0.[Credit Manager], RDADaRicevere_Sommario_step0.GeoZone2Description, RDADaRicevere_Sommario_step0.[Securities Received];

