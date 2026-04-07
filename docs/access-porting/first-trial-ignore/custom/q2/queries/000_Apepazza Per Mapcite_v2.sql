SELECT Customer.City, Customer.County, Format$([Post Code],"00000") AS pc, Sum(Val([no_ of pairs])) AS qty, [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[selling season code]
FROM (([Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_) INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_) INNER JOIN Item ON [Sales Line].No_ = Item.No_
GROUP BY Customer.City, Customer.County, Format$([Post Code],"00000"), Customer.[Country_Region Code], [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[selling season code], [Sales Line].Type, [Sales Header].[order type], [Sales Line].[delete reason], Customer.[Geographical Zone 2]
HAVING (((Customer.[Country_Region Code])="IT") AND (([Sales Header].[Shortcut Dimension 2 Code])="AP") AND (([Sales Line].Type)=20) AND (([Sales Header].[order type])=0) AND (([Sales Line].[delete reason])="") AND ((Customer.[Geographical Zone 2])="33"));

