SELECT [Item Identifier].[Last Location Code Used] AS [Location Code], [Item Identifier].[Item No_], [Item Identifier].[Constant Variable Code], [Item Identifier].[Assortment Code], [Item Identifier].[Last Bin Code Used] AS [Bin Code], [Item Identifier].Code
FROM [Item Identifier]
WHERE ((([Item Identifier].Status)=1));

