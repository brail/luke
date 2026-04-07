SELECT Item.[Trademark Code], Item.[Season Code], [Sales Line].Type, [Sales Line].[Document No_], [Sales Line].No_, Val([DDT_Picking Line.No_ of pairs]) AS shPairs, Val([Sales Line.No_ of pairs]) AS orPairs, [DDT_Picking Header].[Posted Date], [DDT_Picking Header].Status
FROM (([DDT_Picking Line] RIGHT JOIN [Sales Line] ON ([DDT_Picking Line].[Order Line No_] = [Sales Line].[Line No_]) AND ([DDT_Picking Line].[Order No_] = [Sales Line].[Document No_])) INNER JOIN Item ON [Sales Line].No_ = Item.No_) LEFT JOIN [DDT_Picking Header] ON [DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_
WHERE (((Item.[Season Code])="I1415") AND (([Sales Line].Type)=20 Or ([Sales Line].Type)=19));

