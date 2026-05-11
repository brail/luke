SELECT [Purchase Price].[Item No_], Avg(Val([Direct Unit Cost])) AS Costo, Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Code 02], [Purchase Price].[Currency Code]
FROM ([CostiAcquisti-step1] INNER JOIN [Purchase Price] ON [CostiAcquisti-step1].[Item No_] = [Purchase Price].[Item No_]) INNER JOIN Item ON [Purchase Price].[Item No_] = Item.No_
GROUP BY [Purchase Price].[Item No_], Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Code 02], [Purchase Price].[Currency Code], [Purchase Price].[Vendor No_]
HAVING ((([Purchase Price].[Vendor No_])<>"VAL A" And ([Purchase Price].[Vendor No_])<>"VAL B"));

