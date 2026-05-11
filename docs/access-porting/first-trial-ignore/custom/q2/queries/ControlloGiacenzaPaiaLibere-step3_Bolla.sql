SELECT [DDT_Picking Line].No_, [DDT_Picking Line].[Location Code], Sum(Val([ddt_picking line.quantity])) AS qty_bolla
FROM ([DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) AND ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type])) INNER JOIN [DDT_Picking Line] AS [DDT_Picking Line_1] ON ([DDT_Picking Line].[Original Line No_] = [DDT_Picking Line_1].[Line No_]) AND ([DDT_Picking Line].[Document No_] = [DDT_Picking Line_1].[Document No_])
WHERE ((([DDT_Picking Header].status)=0 Or ([DDT_Picking Header].status)=1) AND (([DDT_Picking Line_1].Type)=19) AND (([DDT_Picking Line].Type)=2))
GROUP BY [DDT_Picking Line].No_, [DDT_Picking Line].[Location Code], [DDT_Picking Header].[Document Type]
HAVING ((([DDT_Picking Header].[Document Type])=0));

