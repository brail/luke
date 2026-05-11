SELECT [RicercaEANUPC-step0].[Cross-Reference No_], Item.No_, Item.[model item no_], Item.[Description 2], Item.[season code], Item.[collection code], Item.[trademark code], Item.[variable code 01] AS color, Item.[variable code 02] AS [size]
FROM [RicercaEANUPC-step0] INNER JOIN Item ON [RicercaEANUPC-step0].[Item No_] = Item.No_
WHERE ((([RicercaEANUPC-step0].[Cross-Reference No_])=[forms]![principale]![casellaricercaeanupc]));

