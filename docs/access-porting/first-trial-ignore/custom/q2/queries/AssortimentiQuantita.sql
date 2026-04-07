SELECT [Assortment Quantity].[Assortment Code], [Assortment Quantity].[Variable Group], Sum(Val([Quantity])) AS AssortmentQuantity
FROM [Assortment Quantity]
GROUP BY [Assortment Quantity].[Assortment Code], [Assortment Quantity].[Variable Group];

