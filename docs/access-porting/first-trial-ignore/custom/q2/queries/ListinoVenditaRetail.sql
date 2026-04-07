SELECT [Sales Price].[Item No_], [Sales Price].[Sales Code], Val([Unit Price]) AS Listino
FROM [Sales Price]
WHERE ((([Sales Price].[Sales Code])=[Codice Listino Retail]));

