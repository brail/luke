SELECT [Valid Model Item Assortments].[Model Item No_], [Assortment Quantity].[Variable Group], [Assortment Quantity].[Assortment Code], [Assortment Quantity].[Variable Code], [Assortment Quantity].quantity
FROM [Valid Model Item Assortments] INNER JOIN [Assortment Quantity] ON [Valid Model Item Assortments].[Assortment Code] = [Assortment Quantity].[Assortment Code]
WHERE ((([Assortment Quantity].quantity)>"0"))
ORDER BY [Assortment Quantity].[Variable Code];

