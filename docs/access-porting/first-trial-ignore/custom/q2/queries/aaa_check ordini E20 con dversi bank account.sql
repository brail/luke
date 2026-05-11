SELECT [Sales Header].[Sell-to Customer No_], [Sales Header].No_, [Sales Header].[Bank Account], [Customer Bank Account].IBAN, [Sales Header].[selling season code], [Sales Header].[Document Type]
FROM [Sales Header] LEFT JOIN [Customer Bank Account] ON ([Sales Header].[Sell-to Customer No_] = [Customer Bank Account].[Customer No_]) AND ([Sales Header].[Bank Account] = [Customer Bank Account].Code)
WHERE ((([Sales Header].[selling season code])="E20") AND (([Sales Header].[Document Type])=1));

