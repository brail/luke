SELECT GiacenzaLiberaVeloce_step4_union.*, Item.[model item no_], Item.[variable code 01] AS color, Item.[variable code 02] AS [size], EANCodes.[Cross-Reference No_] AS EAN
FROM (GiacenzaLiberaVeloce_step4_union INNER JOIN Item ON GiacenzaLiberaVeloce_step4_union.[Item No_] = Item.No_) LEFT JOIN EANCodes ON Item.No_ = EANCodes.[Item No_];

