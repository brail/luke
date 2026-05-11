SELECT [Purchase Header].[Order Date], [Purchase Header].[Buy-from Vendor No_], Vendor.Name, [AnalisiDateConsegna-Union].*, Vendor_1.Name AS ManufacturerName
FROM (([AnalisiDateConsegna-Union] INNER JOIN [Purchase Header] ON [AnalisiDateConsegna-Union].OrderNumber = [Purchase Header].No_) INNER JOIN Vendor ON [Purchase Header].[Buy-from Vendor No_] = Vendor.No_) LEFT JOIN Vendor AS Vendor_1 ON [AnalisiDateConsegna-Union].ManufacturerCode = Vendor_1.No_;

