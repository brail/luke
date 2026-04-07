SELECT WMS_WarehouseShipment_prefinal.*, [Item Identifier].Status AS BoxStatus, [Item Identifier].[Last Bin Code Used]
FROM WMS_WarehouseShipment_prefinal LEFT JOIN [Item Identifier] ON WMS_WarehouseShipment_prefinal.Code = [Item Identifier].Code;

