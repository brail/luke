SELECT [Purchase Line].[Document No_], [Purchase Line].[Line No_], [Purchase Line].Type, [Purchase Line].No_, [Purchase Line].[Constant Variable Code], [Purchase Line].[Assortment Code], Val([no_ of pairs]) AS paiariga, Val([quantity])*[AssortmentQuantity] AS paiaricalcolate
FROM [Purchase Line] INNER JOIN AssortimentiQuantita ON [Purchase Line].[Assortment Code] = AssortimentiQuantita.[Assortment Code]
WHERE ((([Purchase Line].Type)=20));

