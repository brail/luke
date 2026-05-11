SELECT [Item].[Season Code], [Item].No_, [Item].Description, [Purch_ Price Model Item].[Vendor No_], [Purch_ Price Model Item].[Starting Date], [Purch_ Price Model Item].[Currency Code], [Purch_ Price Model Item].[Variable Code 01], [Purch_ Price Model Item].[Variable Code 02], [Purch_ Price Model Item].[Ending Date], Val(nz([Direct Unit Cost])) AS Costo
FROM Item LEFT JOIN [Purch_ Price Model Item] ON [Item].No_ = [Purch_ Price Model Item].[Model Item No_]
WHERE ((([Item].[Season Code])="i1011") AND (([Item].[Configurator Relation])=1));

