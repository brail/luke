SELECT [Sales Line].No_, [Sales Line].[constant variable code], [Sales Line].[assortment code], Sum(Val([quantity])) AS sal_qty
FROM [Sales Line] INNER JOIN ([Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_) ON ([Sales Line].[Document Type] = [Sales Header].[Document Type]) AND ([Sales Line].[Document No_] = [Sales Header].No_)
WHERE ((([Sales Header].[selling season code])="E26") AND (([Sales Line].type)=20) AND (([Sales Header].[fast shipping])=1) AND (([Sales Line].[DELETE REASON])=""))
GROUP BY [Sales Line].No_, [Sales Line].[constant variable code], [Sales Line].[assortment code];

