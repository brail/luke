SELECT [Sales Line].[Document Type], [Sales Line].[Document No_], [Sales Line].[Promised Delivery Date], [Sales Line].[Requested Delivery Date], Item.[Season Code], [Sales Header].[Order Type], [Sales Header].[Order Date], [Sales Header].[Document Date]
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN [Sales Header] ON ([Sales Line].[Document No_] = [Sales Header].No_) AND ([Sales Line].[Document Type] = [Sales Header].[Document Type])
WHERE ((([Sales Line].Type)=19 Or ([Sales Line].Type)=20))
GROUP BY [Sales Line].[Document Type], [Sales Line].[Document No_], [Sales Line].[Promised Delivery Date], [Sales Line].[Requested Delivery Date], Item.[Season Code], [Sales Header].[Order Type], [Sales Header].[Order Date], [Sales Header].[Document Date]
HAVING ((([Sales Line].[Document Type])=1));

