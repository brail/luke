SELECT [Warehouse Shipment Line].[Source No_], [Warehouse Shipment Line].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note]
FROM [Warehouse Shipment Header] INNER JOIN [Warehouse Shipment Line] ON [Warehouse Shipment Header].No_ = [Warehouse Shipment Line].No_
GROUP BY [Warehouse Shipment Line].[Source No_], [Warehouse Shipment Line].No_, [Warehouse Shipment Header].[Special Requests], [Warehouse Shipment Header].[Warehouse Speciality Code], [Warehouse Shipment Header].[Warehouse Note]
HAVING ((([Warehouse Shipment Line].[Source No_]) Like "SPD*"));

