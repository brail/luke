SELECT [Sales Line].[Document No_], Val([quantity shipped]) AS spedito, Val([quantity invoiced]) AS fatturato, [spedito]-[fatturato] AS delta, [Sales Line].[Document Type], Item.[Trademark Code], [Sales Line].Type
FROM [Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=2));

