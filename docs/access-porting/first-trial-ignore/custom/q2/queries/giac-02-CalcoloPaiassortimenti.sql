SELECT [Assortment Variable Group].[Assortment Code], [Assortment Variable Group].[Variable Group], Sum([Assortment Quantity].Quantity) AS PaiaPerAssortimento
FROM [Assortment Quantity] INNER JOIN [Assortment Variable Group] ON ([Assortment Quantity].[Variable Group] = [Assortment Variable Group].[Variable Group]) AND ([Assortment Quantity].[Assortment Code] = [Assortment Variable Group].[Assortment Code])
GROUP BY [Assortment Variable Group].[Assortment Code], [Assortment Variable Group].[Variable Group];

