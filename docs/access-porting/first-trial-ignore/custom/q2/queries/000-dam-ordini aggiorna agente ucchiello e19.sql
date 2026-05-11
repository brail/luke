UPDATE [Sales Header] LEFT JOIN [Geographical Zone] ON [Sales Header].[Geographical Zone] = [Geographical Zone].Code SET [Sales Header].[Salesperson Code] = "1100"
WHERE ((([Sales Header].[Salesperson Code])="1049") AND (([Sales Header].[Document Type])=1) AND (([Sales Header].[Selling Season Code])="E19") AND (([Sales Header].[Geographical Zone])="08"));

