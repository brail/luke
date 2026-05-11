UPDATE ([Sales Header] INNER JOIN [Sales Header Extension] ON ([Sales Header].No_ = [Sales Header Extension].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Header Extension].[Document Type])) INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_ SET [Sales Header Extension].[geographical zone 2] = [Customer.geographical zone 2]
WHERE ((([Sales Header Extension].[geographical zone 2])=""));

