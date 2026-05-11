SELECT [Sales Invoice Line].[Document No_], [Sales Invoice Line_1].No_, [Sales Invoice Line].[Model Item No_], [Sales Invoice Line_1].[constant variable code], [Sales Invoice Line].[variable code 01], Val([sales invoice line.quantity]) AS qty, Val([sales invoice line_1.no_ of pairs]) AS paia
FROM [Sales Invoice Line] INNER JOIN [Sales Invoice Line] AS [Sales Invoice Line_1] ON ([Sales Invoice Line].[Document No_] = [Sales Invoice Line_1].[Document No_]) AND ([Sales Invoice Line].[Original Line No_] = [Sales Invoice Line_1].[Line No_])
WHERE ((([Sales Invoice Line_1].[constant variable code])<>[Sales Invoice Line.variable code 01]))
ORDER BY [Sales Invoice Line].[Document No_], [Sales Invoice Line_1].No_;

