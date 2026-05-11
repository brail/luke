SELECT Customer.[Store Image], Customer.[Store Distribution], Customer.[Store Type], Item.[product family], Val([no_ of pairs]) AS qty, Customer.[geographical zone], Customer.[geographical zone 2]
FROM (Item INNER JOIN [Sales Line] ON Item.No_ = [Sales Line].No_) INNER JOIN ([Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_) ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].[delete reason])="") AND (([Sales Header].[selling season code])="E20") AND (([Sales Header].[Shortcut Dimension 2 Code])="AP") AND ((Item.[advertising material])=0));

