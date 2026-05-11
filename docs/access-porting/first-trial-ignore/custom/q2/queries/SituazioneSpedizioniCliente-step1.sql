SELECT [Sales Header].[Shortcut Dimension 2 Code] AS TrademarkCode, [Sales Header].[Selling Season Code], [Sales Header].[Sell-to Customer No_], Customer.Name, [Sales Line].[Document No_], [Sales Header].[Ship-to City], [Sales Line].[requested delivery date], Sum(IIf(Val([quantity])>0,Val([quantity shipped])*Val([no_ of pairs])/Val([quantity]),0)) AS pairsshipped, Sum(Val([no_ of pairs])) AS pairsordered, [Sales Line].[delete reason]
FROM ([Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_) INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Line].type)=19 Or ([Sales Line].type)=20))
GROUP BY [Sales Header].[Shortcut Dimension 2 Code], [Sales Header].[Selling Season Code], [Sales Header].[Sell-to Customer No_], Customer.Name, [Sales Line].[Document No_], [Sales Header].[Ship-to City], [Sales Line].[requested delivery date], [Sales Line].[delete reason]
HAVING ((([Sales Header].[Selling Season Code])=[forms]![principale]![filtrostagioneean2]) AND (([Sales Header].[Sell-to Customer No_])=[forms]![principale]![filtroclienteean]) AND (([Sales Line].[delete reason])=""));

