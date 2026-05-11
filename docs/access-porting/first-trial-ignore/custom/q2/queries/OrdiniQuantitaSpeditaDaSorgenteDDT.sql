SELECT Sum(Val([quantity])) AS qty, [DDT_Picking Line].[Order No_]
FROM [DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON [DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]
WHERE ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Header].status)=20) AND (([DDT_Picking Line].Type)=2))
GROUP BY [DDT_Picking Line].[Order No_];

