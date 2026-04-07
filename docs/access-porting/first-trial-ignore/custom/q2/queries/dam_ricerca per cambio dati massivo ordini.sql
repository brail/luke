SELECT [Sales Line].[selling season code], [Sales Header].[Shortcut Dimension 2 Code], [Sales Header].[Sell-to Customer No_], [Sales Header].[Bill-to Name], [Sales Header].No_, [Sales Line].[Line No_], [Sales Header].[Requested Delivery Date], [Sales Line].[Requested Delivery Date], [Sales Line].[delete reason]
FROM [Sales Header] INNER JOIN [Sales Line] ON [Sales Header].No_ = [Sales Line].[Document No_]
WHERE ((([Sales Line].[selling season code])="I20"));

