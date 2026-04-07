UPDATE [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_ SET [Sales Line].[Salesperson Commission _] = "10.00000000000000000000"
WHERE ((([Sales Header].[SELLING SEASON CODE])="E22") AND (([Sales Header].[Salesperson Code])="1127"));

