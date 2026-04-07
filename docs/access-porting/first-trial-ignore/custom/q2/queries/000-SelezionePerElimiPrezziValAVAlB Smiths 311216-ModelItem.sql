SELECT [Purch_ Price Model Item].[Starting Date], [Purch_ Price Model Item].[Model Item No_], Item.[Trademark Code], Item.[Season Code], [Purch_ Price Model Item].[Vendor No_]
FROM Item INNER JOIN [Purch_ Price Model Item] ON Item.No_ = [Purch_ Price Model Item].[Model Item No_]
WHERE ((([Purch_ Price Model Item].[Starting Date])=#12/31/2016#) AND ((Item.[Trademark Code]) Like "sa%") AND (([Purch_ Price Model Item].[Vendor No_])="val a" Or ([Purch_ Price Model Item].[Vendor No_])="val b"))
ORDER BY [Purch_ Price Model Item].[Model Item No_];

