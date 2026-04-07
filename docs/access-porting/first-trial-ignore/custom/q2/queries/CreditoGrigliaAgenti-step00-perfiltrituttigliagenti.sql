SELECT [qSoloVend-PerGriglieAgenti].[Salesperson Code], [qSoloVend-PerGriglieAgenti].[Sell-to Customer No_], [qSoloVend-PerGriglieAgenti].[season code]
FROM [qSoloVend-PerGriglieAgenti]
GROUP BY [qSoloVend-PerGriglieAgenti].[Salesperson Code], [qSoloVend-PerGriglieAgenti].[Sell-to Customer No_], [qSoloVend-PerGriglieAgenti].[season code]
HAVING ((([qSoloVend-PerGriglieAgenti].[Salesperson Code])=[forms]![principale]![filtroAgentePerGrigliaAgenti]) AND (([qSoloVend-PerGriglieAgenti].[season code])=[forms]![principale]![creditofiltrostagione2]));

