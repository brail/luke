UPDATE [Sales Header] INNER JOIN [Sales Line] ON ([Sales Line].[Document No_] = [Sales Header].No_) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type]) SET [Sales Header].[requested delivery date] = #1/30/2021#, [Sales Line].[requested delivery date] = #1/30/2021#
WHERE ((([Sales Line].[selling season code])="E21") AND (([Sales Header].[Shortcut Dimension 2 Code])="BLAUER") AND (([Sales Header].[requested delivery date])=#1/31/2021#));

