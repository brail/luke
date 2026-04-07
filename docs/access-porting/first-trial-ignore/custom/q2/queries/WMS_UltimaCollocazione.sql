SELECT WMS_UltimaCollocazione_Step5.*, [Item Identifier].[Last Bin Code Used], [Item Identifier].[Item No_], [Item Identifier].[Constant Variable Code], [Item Identifier].[Assortment Code], [Item Identifier].Status, [Item Identifier].Code, Item.[Trademark code], [Item Identifier].[Season Code]
FROM (WMS_UltimaCollocazione_Step5 INNER JOIN [Item Identifier] ON WMS_UltimaCollocazione_Step5.Code = [Item Identifier].Code) INNER JOIN Item ON [Item Identifier].[Item No_] = Item.No_;

