SELECT Export_Sales_Report.order_date, Export_Sales_Report.order_number, Export_Sales_Report.product_qty_ordered, Export_Sales_Report.product_ean, [Item_1.No_] & "_" & [Color] AS ArtCol, Item_1.No_, Item.[variable code 01] AS Color, Item.[variable code 02] AS [Size], Item.[season code], Item.[trademark code], Item.[collection code]
FROM Export_Sales_Report LEFT JOIN (([NavisionEan-step0] LEFT JOIN Item ON [NavisionEan-step0].[Item No_] = Item.No_) LEFT JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_) ON Export_Sales_Report.product_ean = [NavisionEan-step0].[Cross-Reference No_];

