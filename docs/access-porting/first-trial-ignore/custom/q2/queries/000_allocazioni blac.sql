SELECT [DDT_Picking Header].No_, [DDT_Picking Header].[Bill-to Name], [DDT_Picking Line].[model item no_] AS Article, [DDT_Picking Line].[Variable Code 01] AS Color, [DDT_Picking Line].[Variable Code 02] AS [Size], Val([quantity]) AS qty, AllocazioniBlac.FILA
FROM ([DDT_Picking Header] LEFT JOIN [DDT_Picking Line] ON ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) AND ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type])) LEFT JOIN AllocazioniBlac ON ([DDT_Picking Line].[Variable Code 01] = AllocazioniBlac.ColorCode) AND ([DDT_Picking Line].[Model Item No_] = AllocazioniBlac.No_)
WHERE ((([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Line].Type)=2) AND (([DDT_Picking Header].STATUS)=1) AND (([DDT_Picking Header].[Shortcut Dimension 2 Code])="BLAC"))
ORDER BY [DDT_Picking Header].No_, AllocazioniBlac.FILA;

