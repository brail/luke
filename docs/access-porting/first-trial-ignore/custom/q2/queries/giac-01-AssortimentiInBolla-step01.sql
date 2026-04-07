SELECT [Item].*, [DDT_Picking Line].[Constant Variable Code], [DDT_Picking Line].[Assortment Code], [DDT_Picking Line].Quantity
FROM ([DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) AND ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type])) INNER JOIN Item ON [DDT_Picking Line].No_ = [Item].No_
WHERE ((([DDT_Picking Header].Status)=0 Or ([DDT_Picking Header].Status)=1) AND (([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Line].Type)=20));

