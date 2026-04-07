SELECT [Sales Line].[Document Type], [Sales Line].Type, [Sales Line].[Document No_], [Sales Line].[Line No_], Val([quantity]) AS qty, Item.[Season Code], Item.[Trademark Code], [Sales Line].No_, [Sales Line].[Constant Variable Code], [Sales Line].[Assortment Code]
FROM [Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_
WHERE ((([Sales Line].[Document Type])=1 Or ([Sales Line].[Document Type])=5) AND (([Sales Line].Type)=20 Or ([Sales Line].Type)=19) AND ((Val([quantity]))=0) AND (([Sales Line].[Delete Reason])="") AND ((Item.[ADVERTISING MATERIAL])=0))
ORDER BY [Sales Line].[Document No_];

