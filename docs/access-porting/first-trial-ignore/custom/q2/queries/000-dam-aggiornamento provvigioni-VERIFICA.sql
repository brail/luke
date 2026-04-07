SELECT [Sales Header].[SUBJECT 1], [Sales Header].[SUBJECT 2], [Sales Header].[SALESPERSON CODE], [Sales Header].[AREA MANAGER CODE], [Sales Line].[Subject 1 Commission _], [Sales Line].[Subject 2 Commission _], [Sales Line].[Salesperson Commission _], [Sales Line].[Area Manager Commission _]
FROM [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Header].[SALESPERSON CODE])="1127") AND (([Sales Header].[SELLING SEASON CODE])="E22"));

