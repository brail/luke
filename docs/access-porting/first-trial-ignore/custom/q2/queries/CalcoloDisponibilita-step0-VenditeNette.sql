SELECT "Sales" AS Cat, [Sales Header].[Shortcut Dimension 2 Code] AS Trademark, [Sales Line].[selling season code], Item.[LINE CODE], [Sales Line].No_ AS Article, Item.[Description 2], [Sales Line].[Constant variable code] AS Color, [Sales Line].[assortment code] AS Assortment, Sum(Val([outstanding quantity])) AS Qty, Sum(IIf(Val([quantity])>0,Val([no_ of pairs])*Val([outstanding quantity])/Val([QUANTITY]),0)) AS Pairs
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Line].[delete reason])="") AND (([Sales Line].Type)=20) AND ((Item.[advertising material])=0))
GROUP BY "Sales", [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[selling season code], Item.[LINE CODE], [Sales Line].No_, Item.[Description 2], [Sales Line].[Constant variable code], [Sales Line].[assortment code]
HAVING ((([Sales Header].[Shortcut Dimension 2 Code])=[forms]![principale]![FiltroMarchioSourcing]) AND (([Sales Line].[selling season code])=[forms]![principale]![FiltroStagioneSourcing]) AND ((Sum(Val([outstanding quantity])))>0));

