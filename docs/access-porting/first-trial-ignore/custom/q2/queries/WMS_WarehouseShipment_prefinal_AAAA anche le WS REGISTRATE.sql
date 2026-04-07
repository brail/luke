SELECT *, "NonRegistrata" AS StatusWarehouseShipment
FROM WMS_WarehouseCodiciColliEPrelievi;

UNION ALL SELECT *, "Registrata" AS StatusWarehouseShipment
FROM WMS_WarehouseSpedRegCodiciColliEPrelievi_Registrati;

