SELECT ValutazioneMagazzinoTabella.[Item No_], ValutazioneMagazzinoTabella.[Vendor No_], (Val([Direct Unit Cost])) AS Costo, Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Code 02]
FROM ValutazioneMagazzinoTabella INNER JOIN ([Purchase Price] INNER JOIN Item ON [Purchase Price].[Item No_] = Item.No_) ON (ValutazioneMagazzinoTabella.[MaxDiStarting Date] = [Purchase Price].[Starting Date]) AND (ValutazioneMagazzinoTabella.[Vendor No_] = [Purchase Price].[Vendor No_]) AND (ValutazioneMagazzinoTabella.[Item No_] = [Purchase Price].[Item No_]);

