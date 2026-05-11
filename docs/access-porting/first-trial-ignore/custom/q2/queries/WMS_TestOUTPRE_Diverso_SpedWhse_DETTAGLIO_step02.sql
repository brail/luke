SELECT [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note], Sum((Val([quantity]))) AS WhSh_qty, [Warehouse Shipment Line].[Item No_], [Warehouse Shipment Line].[Constant Variable Code], [Warehouse Shipment Line].[Assortment Code], [Warehouse Shipment Line].[Source No_]
FROM [Warehouse Shipment Line] INNER JOIN [Warehouse Shipment Header] ON [Warehouse Shipment Line].No_ = [Warehouse Shipment Header].No_
WHERE ((([Warehouse Shipment Line].[Item Type])=20))
GROUP BY [Warehouse Shipment Header].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note], [Warehouse Shipment Line].[Item No_], [Warehouse Shipment Line].[Constant Variable Code], [Warehouse Shipment Line].[Assortment Code], [Warehouse Shipment Line].[Source No_];

