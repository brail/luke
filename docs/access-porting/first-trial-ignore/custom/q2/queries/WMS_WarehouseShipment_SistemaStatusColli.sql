UPDATE WMS_WarehouseShipment_prefinal INNER JOIN [Item Identifier] ON WMS_WarehouseShipment_prefinal.Code = [Item Identifier].Code SET [Item Identifier].Status = 2
WHERE (((WMS_WarehouseShipment_prefinal.StatusWarehouseShipment)="Registrata") AND (([Item Identifier].Status)<>2));

