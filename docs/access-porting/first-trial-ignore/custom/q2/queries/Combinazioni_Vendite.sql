SELECT [Sales Line].[Season Code], [Sales Line].[shortcut Dimension 2 Code], [Sales Line].Type, [Sales Header].[Sell-to Customer No_], [Sales Line].[Document No_], [Sales Line].[Document Type], [Sales Line].No_, [Sales Line].[Constant Variable Code]
FROM ([Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_) INNER JOIN Combinazioni_Articoli ON ([Sales Line].[Constant Variable Code] = Combinazioni_Articoli.ColorCode) AND ([Sales Line].No_ = Combinazioni_Articoli.Article)
WHERE ((([Sales Line].[Season Code])="E21") AND (([Sales Line].[shortcut Dimension 2 Code])="AP") AND (([Sales Line].Type)=20) AND (([Sales Line].[Document Type])=1) AND (([Sales Header].[order type])=0));

