SELECT [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].No_, [Sales Invoice Header].[Order No_], [Sales Shipment Line].[Order No_], [Sales Invoice Line].Type, Sum(Val([Amount])) AS IMPORTO, [Sales Invoice Header].[Geographical Zone 2]
FROM ([Sales Invoice Line] INNER JOIN [Sales Shipment Line] ON ([Sales Invoice Line].[Shipment No_] = [Sales Shipment Line].[Document No_]) AND ([Sales Invoice Line].[Shipment Line No_] = [Sales Shipment Line].[Line No_])) INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_
WHERE ((([Sales Invoice Header].[Posting Date]) Between #1/1/2019# And #4/30/2019#))
GROUP BY [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].No_, [Sales Invoice Header].[Order No_], [Sales Shipment Line].[Order No_], [Sales Invoice Line].Type, [Sales Invoice Header].[Geographical Zone 2]
HAVING ((([Sales Invoice Line].Type)<>19 And ([Sales Invoice Line].Type)<>20) AND (([Sales Invoice Header].[Geographical Zone 2])="33"));

