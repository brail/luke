SELECT [Sales Price].[Item No_], [Sales Price].[Sales Code], Val([Unit Price]) AS WSPrice
FROM [Sales Price]
WHERE ((([Sales Price].[Sales Code])=[ListinoWholesale]));

