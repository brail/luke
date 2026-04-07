SELECT [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note], Sum((Val([quantity]))) AS WhSh_qty
FROM [Warehouse Shipment Line] INNER JOIN [Warehouse Shipment Header] ON [Warehouse Shipment Line].No_ = [Warehouse Shipment Header].No_
WHERE ((([Warehouse Shipment Line].[Item Type])=20))
GROUP BY [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note];

