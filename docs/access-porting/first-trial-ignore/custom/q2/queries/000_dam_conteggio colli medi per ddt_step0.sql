SELECT [DDT_Picking Line].[Document Type], [DDT_Picking Line].[Document No_], Sum(Val([quantity])) AS NumeroColli, [DDT_Picking Header].[Selling Season Code]
FROM [DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON [DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_
WHERE ((([DDT_Picking Line].Type)=20) AND (([DDT_Picking Header].status)=20))
GROUP BY [DDT_Picking Line].[Document Type], [DDT_Picking Line].[Document No_], [DDT_Picking Header].[Selling Season Code]
HAVING ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Header].[Selling Season Code])="I21" Or ([DDT_Picking Header].[Selling Season Code])="E22"));

