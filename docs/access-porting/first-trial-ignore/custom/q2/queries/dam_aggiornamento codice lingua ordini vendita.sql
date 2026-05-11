UPDATE [Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_ SET [Sales Header].[Language Code] = [Customer.Language Code]
WHERE ((([Sales Header].[Selling Season Code])="E25"));

