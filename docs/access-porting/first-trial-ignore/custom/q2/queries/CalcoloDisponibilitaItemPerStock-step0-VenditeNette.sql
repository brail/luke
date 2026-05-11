SELECT "Sales" AS Cat, [Sales Header].[Shortcut Dimension 2 Code] AS Trademark, [Sales Line].[selling season code], Item.[LINE CODE], [Sales Line].[model item No_] AS Article, Item.[Description 2], [Sales Line].[variable code 01] AS Color, [Sales Line].[variable code 02] AS [size], Sum(Val([outstanding quantity])) AS Qty, Sum(IIf(Val([quantity])>0,Val([no_ of pairs])*Val([outstanding quantity])/Val([QUANTITY]),0)) AS Pairs
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Header].[Order Type])=3) AND (([Sales Line].[delete reason])="") AND (([Sales Line].Type)=2) AND ((Item.[advertising material])=0))
GROUP BY "Sales", [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[selling season code], Item.[LINE CODE], [Sales Line].[model item No_], Item.[Description 2], [Sales Line].[variable code 01], [Sales Line].[variable code 02]
HAVING ((([Sales Header].[Shortcut Dimension 2 Code])=[forms]![principale]![FiltroMarchioSourcing]) AND (([Sales Line].[selling season code])=[forms]![principale]![FiltroStagioneSourcing]) AND ((Sum(Val([outstanding quantity])))>0));

