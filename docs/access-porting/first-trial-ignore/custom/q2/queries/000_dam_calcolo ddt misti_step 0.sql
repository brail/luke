SELECT [DDT_Picking Line].[Document No_], [DDT_Picking Header].[Sell-to Customer No_], [DDT_Picking Header].[Bill-to Name], [DDT_Picking Line].Type, [DDT_Picking Line].[Selling Season Code], Sum(Val([no_ of pairs])) AS paia, [DDT_Picking Line].[Shortcut Dimension 2 Code] AS TrademarkCode, [DDT_Picking Line].[Shortcut Dimension 1 Code] AS CCR
FROM [DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON [DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]
WHERE ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Header].[posted date])>=#1/1/2024#))
GROUP BY [DDT_Picking Line].[Document No_], [DDT_Picking Header].[Sell-to Customer No_], [DDT_Picking Header].[Bill-to Name], [DDT_Picking Line].Type, [DDT_Picking Line].[Selling Season Code], [DDT_Picking Line].[Shortcut Dimension 2 Code], [DDT_Picking Line].[Shortcut Dimension 1 Code]
HAVING ((([DDT_Picking Line].Type)=20 Or ([DDT_Picking Line].Type)=19));

