SELECT [DDT_Picking Header].status, [DDT_Picking Header].No_ AS SPD_No, [DDT_Picking Header].[posting date], [DDT_Picking Line].[Order No_], Sum(Val([no_ of pairs])) AS qty
FROM [DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON [DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]
GROUP BY [DDT_Picking Header].status, [DDT_Picking Header].No_, [DDT_Picking Header].[posting date], [DDT_Picking Line].[Order No_], [DDT_Picking Header].[Document Type], [DDT_Picking Line].Type
HAVING ((([DDT_Picking Header].status)=0 Or ([DDT_Picking Header].status)=1) AND (([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Line].Type)=19 Or ([DDT_Picking Line].Type)=20));

