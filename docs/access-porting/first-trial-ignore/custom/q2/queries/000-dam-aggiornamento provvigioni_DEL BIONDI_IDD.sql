UPDATE [Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_ SET [Sales Line].[Subject 2 Commission _] = "1.85000000000000000000", [Sales Line].[Commission Group Code] = "IDD_25"
WHERE ((([Sales Line].[Subject 2 Commission _])="1.50000000000000000000") AND (([Sales Header].[SELLING SEASON CODE])="I25") AND (([Sales Header].[Subject 2])="1002"));

