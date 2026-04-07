SELECT [Sales Header].[Document Type], [Sales Header].No_, [Sales Line].[Line No_], [Sales Line].[Sell-to Customer No_], [Sales Line].Type, [Item].No_, [Item].[Trademark Code], [Item].[Season Code], Val([No_ of Pairs]) AS Paia, [Sales Header].[Document Date], [Sales Line].[Delete Reason]
FROM ([Sales Header] INNER JOIN [Sales Line] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type])) INNER JOIN Item ON [Sales Line].No_ = [Item].No_
WHERE ((([Sales Header].[Document Type])=1) AND (([Sales Line].Type)=19 Or ([Sales Line].Type)=20) AND (([Sales Line].[Delete Reason])<>"FEB-COMM"));

