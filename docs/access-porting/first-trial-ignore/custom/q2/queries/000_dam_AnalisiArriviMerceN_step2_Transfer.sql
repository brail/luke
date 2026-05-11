SELECT [000_dam_AnalisiArriviMerceN_step1_Transfer].*, Item.[trademark code], Vendor.Name AS Vendor, Vendor_1.Name AS Manufacturer, Item.[Line Code], Item.[Inventory Posting Group], Item.[Country_Region of Origin Code]
FROM 000_dam_AnalisiArriviMerceN_step1_Transfer LEFT JOIN ((Item LEFT JOIN Vendor ON Item.[Vendor No_] = Vendor.No_) LEFT JOIN Vendor AS Vendor_1 ON Item.Manufacturer = Vendor_1.No_) ON [000_dam_AnalisiArriviMerceN_step1_Transfer].[Item No_] = Item.No_;

