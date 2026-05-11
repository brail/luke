SELECT [Sales Invoice Line].[Document No_], [Sales Shipment Line].[DDT No_], [Sales Invoice Header].[POSTING DATE]
FROM ([Sales Invoice Line] INNER JOIN [Sales Shipment Line] ON ([Sales Invoice Line].[Shipment Line No_] = [Sales Shipment Line].[Line No_]) AND ([Sales Invoice Line].[Shipment No_] = [Sales Shipment Line].[Document No_])) INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_
GROUP BY [Sales Invoice Line].[Document No_], [Sales Shipment Line].[DDT No_], [Sales Invoice Header].[POSTING DATE]
HAVING ((([Sales Invoice Header].[POSTING DATE]) Between [DataIniziale] And [DataFinale]));

