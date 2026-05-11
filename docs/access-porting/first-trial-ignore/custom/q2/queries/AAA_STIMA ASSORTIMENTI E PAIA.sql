SELECT Val([SALES LINE.QUANTITY]) AS QTY_ass, [Sales Header].[Shortcut Dimension 2 Code], [Sales Header].[SELLING SEASON CODE], [Sales Line].[DELETE REASON], [Sales Line].[ASSORTMENT CODE], [Sales Line].[Document Type], [Sales Header].[ORDER TYPE], [Sales Line].type, Val([no_ of pairs]) AS paia
FROM [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Header].[Shortcut Dimension 2 Code])="BLAUER") AND (([Sales Line].[DELETE REASON])="") AND (([Sales Line].[Document Type])=1) AND (([Sales Header].[ORDER TYPE])=0 Or ([Sales Header].[ORDER TYPE])=2) AND (([Sales Line].type)=20));

