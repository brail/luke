SELECT [Sales Line].[Document No_], [Sales Line].[Model Item No_], [Sales Line_1].[constant variable code], [Sales Line].[variable code 01], Val([sales line.quantity]) AS qty, Val([sales line_1.no_ of pairs]) AS paia
FROM [Sales Line] INNER JOIN [Sales Line] AS [Sales Line_1] ON ([Sales Line].[Document No_] = [Sales Line_1].[Document No_]) AND ([Sales Line].[Original Line No_] = [Sales Line_1].[Line No_])
WHERE ((([Sales Line_1].[constant variable code])<>[Sales Line.variable code 01]))
ORDER BY [Sales Line].[Document No_];

