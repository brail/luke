SELECT [Transfer Shipment Header].No_ AS [Order Number], 0 AS Line, [Transfer Shipment Header].[Posting Date] AS [Document Date], Vendor.No_ AS [Supplier Code], Vendor.Name AS [Supplier Name], "" AS [Order Reference], [NavisionEan-step0].[Cross-Reference No_] AS SKU, Sum(Val([quantity])) AS qty
FROM ((([Transfer Shipment Header] INNER JOIN [Transfer Shipment Line] ON [Transfer Shipment Header].No_ = [Transfer Shipment Line].[Document No_]) INNER JOIN Item ON [Transfer Shipment Line].[Item No_] = Item.No_) LEFT JOIN Vendor ON Item.[Vendor No_] = Vendor.No_) LEFT JOIN [NavisionEan-step0] ON [Transfer Shipment Line].[Item No_] = [NavisionEan-step0].[Item No_]
WHERE ((([Transfer Shipment Line].[Item Type])=0))
GROUP BY [Transfer Shipment Header].No_, 0, [Transfer Shipment Header].[Posting Date], Vendor.No_, Vendor.Name, "", [NavisionEan-step0].[Cross-Reference No_]
HAVING ((([Transfer Shipment Header].No_)=[Numero Spedizone Trasferimento Registrata]));

