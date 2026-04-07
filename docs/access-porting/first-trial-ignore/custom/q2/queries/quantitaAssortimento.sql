SELECT Sum(Val([Quantity])) AS quantitaassortimento, [Assortment Quantity].[Assortment Code]
FROM [Assortment Quantity]
GROUP BY [Assortment Quantity].[Assortment Code];

