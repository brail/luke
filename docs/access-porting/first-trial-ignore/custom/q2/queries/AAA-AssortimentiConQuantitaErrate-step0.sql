SELECT [Sales Line].[Document No_], [Sales Line].[Line No_], [Sales Line].Type, [Sales Line].No_, [Sales Line].[Constant Variable Code], [Sales Line].[Assortment Code], Val([no_ of pairs]) AS paiariga, Val([quantity])*[AssortmentQuantity] AS paiaricalcolate
FROM [Sales Line] INNER JOIN AssortimentiQuantita ON [Sales Line].[Assortment Code] = AssortimentiQuantita.[Assortment Code]
WHERE ((([Sales Line].Type)=20));

