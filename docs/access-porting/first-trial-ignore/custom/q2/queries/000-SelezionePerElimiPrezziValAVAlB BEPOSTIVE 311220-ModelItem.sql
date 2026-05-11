SELECT [Purch_ Price Model Item].[Starting Date], [Purch_ Price Model Item].[Model Item No_], Item.[Trademark Code], Item.[Season Code], [Purch_ Price Model Item].[Vendor No_]
FROM Item INNER JOIN [Purch_ Price Model Item] ON Item.No_ = [Purch_ Price Model Item].[Model Item No_]
WHERE ((([Purch_ Price Model Item].[Starting Date])=#12/31/2020#) AND ((Item.[Trademark Code])="BEPOSITIVE") AND (([Purch_ Price Model Item].[Vendor No_])="VAL A" Or ([Purch_ Price Model Item].[Vendor No_])="VAL B"))
ORDER BY [Purch_ Price Model Item].[Model Item No_];

