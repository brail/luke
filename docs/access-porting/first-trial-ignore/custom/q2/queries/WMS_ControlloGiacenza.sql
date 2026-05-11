SELECT WMS_ControlloGiacenza_04_Union.InventoryType, WMS_ControlloGiacenza_04_Union.[Location Code], Item.[Trademark Code], Item.[Season Code], Item.[Collection Code], WMS_ControlloGiacenza_04_Union.Article, WMS_ControlloGiacenza_04_Union.Color, WMS_ControlloGiacenza_04_Union.[Assortment Code], WMS_ControlloGiacenza_04_Union.[Bin Code], WMS_ControlloGiacenza_04_Union.Code, WMS_ControlloGiacenza_04_Union.qty
FROM WMS_ControlloGiacenza_04_Union INNER JOIN Item ON WMS_ControlloGiacenza_04_Union.Article = Item.No_;

