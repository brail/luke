SELECT [Sales Price].[Item No_], [Sales Price].[Sales Type], [Sales Price].[Sales Code], Val([Unit Price]) AS SRP
FROM [Sales Price]
WHERE ((([Sales Price].[Sales Code])=[Listino]));

