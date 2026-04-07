SELECT [Sales Header].[Shortcut Dimension 2 Code] AS [Trademark Code], [Sales Header].[selling season code] AS [Season Code], [Sales Line].[Document No_], [Sales Line].[Line No_], Val([Outstanding Quantity]) AS qty, "SOLD" AS CAT, [Sales Line].[delete reason]
FROM [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Header].[Shortcut Dimension 2 Code])=[Forms]![principale]![FiltroMarchioSourcing]) AND (([Sales Header].[selling season code])=[Forms]![principale]![FiltroStagioneSourcing]) AND (([Sales Line].Type)=2));

