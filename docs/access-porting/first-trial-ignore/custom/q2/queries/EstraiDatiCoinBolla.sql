SELECT "XXXX - INSERIRE" AS CodiceNegozioOVS, [Transfer Shipment Header].[DDT No_] AS [Numero Bolla], [Transfer Shipment Header].[Date DDT] AS [data bolla], EANCodes.[Cross-Reference No_] AS EAN, Val([quantity]) AS quantita
FROM ([Transfer Shipment Header] INNER JOIN [Transfer Shipment Line] ON [Transfer Shipment Header].No_ = [Transfer Shipment Line].[Document No_]) INNER JOIN ((Item INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_) LEFT JOIN EANCodes ON Item.No_ = EANCodes.[Item No_]) ON [Transfer Shipment Line].[Item No_] = Item.No_
WHERE ((([Transfer Shipment Header].[DDT No_])=[forms]![principale]![FiltroDDTDaTrasferimento]))
ORDER BY "XXXX - INSERIRE";

