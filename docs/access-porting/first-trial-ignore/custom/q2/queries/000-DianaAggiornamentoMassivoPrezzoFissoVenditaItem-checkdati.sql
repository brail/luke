SELECT [Sales Line].[Sell-to Customer No_], Customer.Name, [Sales Line].[Fixed Unit Price], [Sales Line].[Unit Price], [Sales Line].No_, [Sales Line].[Document No_], Val([quantity]) AS qty
FROM [Sales Line] INNER JOIN Customer ON [Sales Line].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Line].[Sell-to Customer No_])="C05298") AND (([Sales Line].[Document No_])>="OV-24/01497") AND (([Sales Line].Type)=2));

