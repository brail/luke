SELECT Customer.[language code], [Sales Header].[Language Code], Customer.No_, Customer.Name
FROM [Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Header].[Selling Season Code])="I22"));

