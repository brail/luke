SELECT [DDT_Picking Header].[Document Type], [DDT_Picking Header].status, [DDT_Picking Line].No_, [DDT_Picking Header].No_, [DDT_Picking Line].[Line No_], Val([Quantity]) AS QTY, [DDT_Picking Line].Type
FROM [DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON ([DDT_Picking Line].[Document Type] = [DDT_Picking Header].[Document Type]) AND ([DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_)
WHERE ((([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Header].status)=0) AND (([DDT_Picking Line].No_) Like "MMI02/VERNICE%" Or ([DDT_Picking Line].No_) Like "MMI02/METAL%" Or ([DDT_Picking Line].No_) Like "MMI04/SUEDE%" Or ([DDT_Picking Line].No_) Like "MMI04/METAL%"));

