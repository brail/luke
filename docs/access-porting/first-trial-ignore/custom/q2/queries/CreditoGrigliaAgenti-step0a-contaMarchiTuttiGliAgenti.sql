SELECT [qSoloVend-PerGriglieAgenti].[Salesperson Code], [qSoloVend-PerGriglieAgenti].Salesperson, [qSoloVend-PerGriglieAgenti].[Sell-to Customer No_], [qSoloVend-PerGriglieAgenti].[Sell-to Name], [qSoloVend-PerGriglieAgenti].[trademark code], [qSoloVend-PerGriglieAgenti].[season code]
FROM [qSoloVend-PerGriglieAgenti]
GROUP BY [qSoloVend-PerGriglieAgenti].[Salesperson Code], [qSoloVend-PerGriglieAgenti].Salesperson, [qSoloVend-PerGriglieAgenti].[Sell-to Customer No_], [qSoloVend-PerGriglieAgenti].[Sell-to Name], [qSoloVend-PerGriglieAgenti].[trademark code], [qSoloVend-PerGriglieAgenti].[season code]
HAVING ((([qSoloVend-PerGriglieAgenti].[season code])=[forms]![principale]![creditofiltrostagione2]))
ORDER BY [qSoloVend-PerGriglieAgenti].[Sell-to Name], [qSoloVend-PerGriglieAgenti].[trademark code];

