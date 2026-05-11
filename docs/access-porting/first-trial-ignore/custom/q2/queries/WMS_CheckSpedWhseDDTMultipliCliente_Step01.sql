SELECT [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Warehouse Note], [Warehouse Shipment Line].[Source No_]
FROM [Warehouse Shipment Line] INNER JOIN [Warehouse Shipment Header] ON [Warehouse Shipment Line].No_ = [Warehouse Shipment Header].No_
GROUP BY [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Warehouse Note], [Warehouse Shipment Line].[Source No_];

