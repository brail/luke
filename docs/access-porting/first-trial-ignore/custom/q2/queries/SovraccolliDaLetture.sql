SELECT [SovraccolliDaLetture-step0].*, Item.[Model Item No_] AS Article, Item.[Variable Code 01] AS Colore, Item.[Variable Code 02] AS taglia
FROM ([SovraccolliDaLetture-step0] LEFT JOIN EANUPC_CleanDoubled_PerSovraccolli ON [SovraccolliDaLetture-step0].EANCODELETTORETXT = EANUPC_CleanDoubled_PerSovraccolli.[Cross-Reference No_]) LEFT JOIN Item ON EANUPC_CleanDoubled_PerSovraccolli.[Item No_] = Item.No_
ORDER BY [SovraccolliDaLetture-step0].CARTONE, [SovraccolliDaLetture-step0].EANCODELETTORETXT;

