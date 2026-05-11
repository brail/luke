SELECT [DDT_Picking Header].[Document Type], [DDT_Picking Header].No_, [Sales Line].Reference, [Sales Line].[Customer Order Ref_]
FROM ([DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON [DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_) INNER JOIN [Sales Line] ON ([DDT_Picking Line].[Order Line No_] = [Sales Line].[Line No_]) AND ([DDT_Picking Line].[Order No_] = [Sales Line].[Document No_])
GROUP BY [DDT_Picking Header].[Document Type], [DDT_Picking Header].No_, [Sales Line].Reference, [Sales Line].[Customer Order Ref_]
HAVING ((([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Header].No_)=[forms]![principale]![numerospd]));

