SELECT [Transfer Shipment Header].No_, [Transfer Shipment Header].[Transfer-to Code], [Transfer Shipment Line].[Item No_], Val([Quantity]) AS Paia, CostiAcquisti.Costo, Item.[Season Code], Item.[Trademark Code], Sum([paia]*[costo]) AS Valore
FROM (([Transfer Shipment Line] INNER JOIN [Transfer Shipment Header] ON [Transfer Shipment Line].[Document No_] = [Transfer Shipment Header].No_) INNER JOIN Item ON [Transfer Shipment Line].[Item No_] = Item.No_) INNER JOIN CostiAcquisti ON Item.No_ = CostiAcquisti.[Item No_]
GROUP BY [Transfer Shipment Header].No_, [Transfer Shipment Header].[Transfer-to Code], [Transfer Shipment Line].[Item No_], Val([Quantity]), CostiAcquisti.Costo, Item.[Season Code], Item.[Trademark Code]
HAVING ((([Transfer Shipment Header].[Transfer-to Code]) Like "CM%"));

