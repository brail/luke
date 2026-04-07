SELECT [Sales Line].[Document No_], [Sales Line_1].[Line No_], [Sales Line_1].No_, [Sales Line].[Model Item No_], [Sales Line_1].[constant variable code], [Sales Line].[variable code 01], Sum(Val([sales line.quantity])) AS qty, First(Val([sales line_1.no_ of pairs])) AS paia
FROM [Sales Line] AS [Sales Line_1] INNER JOIN [Sales Line] ON ([Sales Line].[Original Line No_] = [Sales Line_1].[Line No_]) AND ([Sales Line_1].[Document No_] = [Sales Line].[Document No_])
GROUP BY [Sales Line].[Document No_], [Sales Line_1].[Line No_], [Sales Line_1].No_, [Sales Line].[Model Item No_], [Sales Line_1].[constant variable code], [Sales Line].[variable code 01]
HAVING (((Sum(Val([sales line.quantity])))<>First(Val([sales line_1.no_ of pairs]))));

