SELECT Avg((Val([Direct Unit Cost]))) AS Costo, Item.[Model Item No_], Item.[Variable Code 01]
FROM ValutazioneMagazzinoTabella INNER JOIN ([Purchase Price] INNER JOIN Item ON [Purchase Price].[Item No_] = Item.No_) ON (ValutazioneMagazzinoTabella.[MaxDiStarting Date] = [Purchase Price].[Starting Date]) AND (ValutazioneMagazzinoTabella.[Vendor No_] = [Purchase Price].[Vendor No_]) AND (ValutazioneMagazzinoTabella.[Item No_] = [Purchase Price].[Item No_])
WHERE (((ValutazioneMagazzinoTabella.[Vendor No_])="VAL A"))
GROUP BY Item.[Model Item No_], Item.[Variable Code 01];

