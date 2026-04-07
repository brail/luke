SELECT [Purchase Price].[Starting Date], [Purchase Price].[Item No_], Item.[Trademark Code], Item.[Season Code], [Purchase Price].[Vendor No_]
FROM [Purchase Price] INNER JOIN Item ON [Purchase Price].[Item No_] = Item.No_
WHERE ((([Purchase Price].[Starting Date])=#12/31/2020#) AND ((Item.[Trademark Code])="BEPOSITIVE") AND (([Purchase Price].[Vendor No_])="VAL A" Or ([Purchase Price].[Vendor No_])="VAL B"));

