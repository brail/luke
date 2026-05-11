SELECT [Sales Header].No_, [Sales Line].[Line No_], [Sales Line].[Sell-to Customer No_], [Sales Header].[Sell-to Customer No_]
FROM [Sales Header] INNER JOIN [Sales Line] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type])
WHERE ([Sales Header.Sell-to Customer No_]<>[Sales Line.Sell-to Customer No_]) and ([Sales Line.Sell-to Customer No_]<>'');

