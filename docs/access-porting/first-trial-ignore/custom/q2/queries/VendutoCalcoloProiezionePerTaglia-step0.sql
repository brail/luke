SELECT [Sales Header].[Budget No_], Sum(Val([Quantity])) AS PairsSold, [Sales Line].[Variable Code 02] AS [Size], Item.[PRODUCT SEX] AS ProductGender, [Sales Header].[Shortcut Dimension 2 Code] AS [Trademark Code], [Sales Header].[Selling Season Code] AS [Season Code]
FROM ([Sales Line] INNER JOIN [Sales Header] ON ([Sales Line].[Document No_] = [Sales Header].No_) AND ([Sales Line].[Document Type] = [Sales Header].[Document Type])) INNER JOIN Item ON [Sales Line].No_ = Item.No_
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=2) AND (([Sales Line].[Delete Reason])="") AND ((Item.[advertising material])=0))
GROUP BY [Sales Header].[Budget No_], [Sales Line].[Variable Code 02], Item.[PRODUCT SEX], [Sales Header].[Shortcut Dimension 2 Code], [Sales Header].[Selling Season Code]
HAVING ((([Sales Header].[Shortcut Dimension 2 Code])=[Forms]![principale]![FiltroMarchioSourcing]) AND (([Sales Header].[Selling Season Code])=[forms]![principale]![FiltroStagioneSourcing]));

