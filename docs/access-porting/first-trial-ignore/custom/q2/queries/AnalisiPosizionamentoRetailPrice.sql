SELECT [Sales Price].[Item No_], [Sales Price].[Sales Code], Val([Unit Price]) AS RetailPrice
FROM [Sales Price]
WHERE ((([Sales Price].[Sales Code])=[ListinoRetail]));

