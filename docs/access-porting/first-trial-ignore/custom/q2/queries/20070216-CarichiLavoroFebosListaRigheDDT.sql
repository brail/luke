SELECT [DDT_Picking Header].[Document Type], [DDT_Picking Header].No_, Val([No_ of Pairs]) AS Paia, [DDT_Picking Line].Type, [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_]
FROM [DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) AND ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type])
WHERE ((([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Line].Type)=19 Or ([DDT_Picking Line].Type)=20));

