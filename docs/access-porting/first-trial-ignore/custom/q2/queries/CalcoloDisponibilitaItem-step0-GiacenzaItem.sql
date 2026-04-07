SELECT "INV" AS Cat, Item.[Trademark Code] AS Trademark, Item.[Season Code] AS [Selling season code], Item.[LINE CODE], [Item Ledger Entry].[Model Item No_] AS Article, Item.[Description 2], [Item Ledger Entry].[variable code 01] AS Color, [Item Ledger Entry].[variable code 02] AS [size], Sum(Val([Quantity])) AS qty, Sum(0) AS pairs
FROM ([Item Ledger Entry] INNER JOIN Location ON [Item Ledger Entry].[Location Code] = Location.Code) INNER JOIN Item ON [Item Ledger Entry].[Model Item No_] = Item.No_
WHERE (((Item.[ADVERTISING MATERIAL])=0) AND ((Location.[Enable to Purchase Run])=1))
GROUP BY "INV", Item.[Trademark Code], Item.[Season Code], Item.[LINE CODE], [Item Ledger Entry].[Model Item No_], Item.[Description 2], [Item Ledger Entry].[variable code 01], [Item Ledger Entry].[variable code 02]
HAVING (((Item.[Trademark Code])=[forms]![principale]![FiltroMarchioSourcing]) AND ((Item.[Season Code])=[forms]![principale]![FiltroStagioneSourcing]) AND ((Sum(Val([Quantity])))<>0));

