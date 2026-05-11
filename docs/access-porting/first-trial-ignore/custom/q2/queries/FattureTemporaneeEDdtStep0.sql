SELECT [Sales Header].No_, [Sales Shipment Header].[DDT No_], [Sales Shipment Header].[Posting Date], [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_]
FROM (([Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_) INNER JOIN [Sales Shipment Header] ON [Sales Line].[Shipment No_] = [Sales Shipment Header].No_) INNER JOIN [DDT_Picking Header] ON [Sales Shipment Header].[DDT No_] = [DDT_Picking Header].No_
WHERE ((([Sales Line].Type)=2) AND (([Sales Header].[Document Type])=2))
GROUP BY [Sales Header].No_, [Sales Shipment Header].[DDT No_], [Sales Shipment Header].[Posting Date], [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_];

