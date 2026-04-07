SELECT [Sales Header].[Order Date], [Sales Line].[requested delivery date], [Sales Header].No_, [Sales Header].[Sell-to Customer No_], [Sales Header].[Sell-to Customer Name], [Sales Line].No_, [Sales Line].Type, [Sales Line].[Constant Variable Code], [Sales Line].[variable code 01], [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[SELLING SEASON CODE], Sum(Val([NO_ OF PAIRS])) AS PAIA1, Sum(Val([QUANTITY])) AS PAIA2
FROM [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
GROUP BY [Sales Header].[Order Date], [Sales Line].[requested delivery date], [Sales Header].No_, [Sales Header].[Sell-to Customer No_], [Sales Header].[Sell-to Customer Name], [Sales Line].No_, [Sales Line].Type, [Sales Line].[Constant Variable Code], [Sales Line].[variable code 01], [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[SELLING SEASON CODE], [Sales Line].[Line No_]
HAVING ((([Sales Line].Type)<>2) AND (([Sales Header].[Shortcut Dimension 2 Code])="BLAUER") AND (([Sales Line].[SELLING SEASON CODE])="I22"))
ORDER BY [Sales Header].No_, [Sales Line].[Line No_];

