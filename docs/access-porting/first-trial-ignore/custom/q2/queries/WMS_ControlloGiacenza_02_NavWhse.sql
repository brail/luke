SELECT [Warehouse Entry].[Location Code], [Warehouse Entry].[Item No_], [Warehouse Entry].[Constant Variable Code], [Warehouse Entry].[Assortment Code], [Warehouse Entry].[Bin Code], Sum(Val([Quantity])) AS qty
FROM [Warehouse Entry]
GROUP BY [Warehouse Entry].[Location Code], [Warehouse Entry].[Item No_], [Warehouse Entry].[Constant Variable Code], [Warehouse Entry].[Assortment Code], [Warehouse Entry].[Bin Code]
HAVING ((([Warehouse Entry].[Location Code])="PMAG" Or ([Warehouse Entry].[Location Code])="SPMAG") AND ((Sum(Val([Quantity])))<>0));

