SELECT [Purchase Price].[Starting Date], [Purchase Price].[Item No_], Item.[Trademark Code], Item.[Season Code], [Purchase Price].[Vendor No_]
FROM [Purchase Price] INNER JOIN Item ON [Purchase Price].[Item No_] = Item.No_
WHERE ((([Purchase Price].[Starting Date])=#12/31/2016#) AND ((Item.[Trademark Code]) Like "sa%") AND (([Purchase Price].[Vendor No_])="val a" Or ([Purchase Price].[Vendor No_])="val b"));

