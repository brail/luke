SELECT [SovraccolliDaLetture_UPC-step0].*, Item.[Model Item No_] AS Article, Item.[Variable Code 01] AS Colore, Item.[Variable Code 02] AS taglia
FROM ([SovraccolliDaLetture_UPC-step0] LEFT JOIN UPCCodes_CleanDoubled_PerSovraccolli ON [SovraccolliDaLetture_UPC-step0].EANCODELETTORETXT = UPCCodes_CleanDoubled_PerSovraccolli.[Cross-Reference No_]) LEFT JOIN Item ON UPCCodes_CleanDoubled_PerSovraccolli.[Item No_] = Item.No_
ORDER BY [SovraccolliDaLetture_UPC-step0].CARTONE, [SovraccolliDaLetture_UPC-step0].EANCODELETTORETXT;

