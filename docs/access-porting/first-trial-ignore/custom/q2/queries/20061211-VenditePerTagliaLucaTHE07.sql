SELECT [Sales Line].[Document Type], [Sales Line].Type, [Sales Line].No_, [Item].[Season Code], [Item].[Trademark Code], [Item].[Variable Group 01], [Item].[Variable Code 01], [Item].[Variable Group 02], [Item].[Variable Code 02], [Sales Line].[Delete Reason], Val([quantity]) AS Paia, [Item].[Product Sex], Val([Quantity Shipped]) AS PaiaSpedite
FROM [Sales Line] INNER JOIN Item ON [Sales Line].No_ = [Item].No_
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=2) AND (([Item].[Season Code])="i0607") AND (([Item].[Trademark Code])="th") AND (([Sales Line].[Delete Reason])="") AND (([Item].[Product Sex])=""));

