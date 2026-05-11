SELECT [20060214-PrezziZJoinBambinoBoth].Article, [20060214-PrezziZJoinBambinoBoth].Descr, [20060214-PrezziZJoinBambinoBoth].TrademarkCode, [20060214-PrezziZJoinBambinoBoth].LineCode, [20060214-PrezziZJoinBambinoBoth].ProductFamily, [20060214-PrezziZJoinBambinoBoth].ProductSex, [20060214-PrezziZJoinBambinoBoth].SizeGroup, [20060214-PrezziZJoinBambinoBoth].ColorGroup, [20060214-PrezziZJoinBambinoBoth].Color, [20060214-PrezziZJoinBambinoBoth].ColorDescr, [20060214-PrezziZJoinBambinoBoth].SizeRange, [20060214-PrezziZJoinBambinoBoth].PurchPrice, [20060214-PrezziZJoinBambinoBoth].SalesPrice
FROM [20060214-PrezziZJoinBambinoBoth];

union all 
SELECT Article, Descr, TrademarkCode, LineCode, ProductFamily, ProductSex, SizeGroup, ColorGroup, Color, ColorDescr, SizeRange, PurchPrice, SalesPrice
FROM [20060214-PrezziZJoinBambinoSoloAcquisto];

UNION ALL SELECT Article, Descr, TrademarkCode, LineCode, ProductFamily, ProductSex, SizeGroup, ColorGroup, Color, ColorDescr, SizeRange, PurchPrice, SalesPrice
FROM [20060214-PrezziZJoinBambinoSoloVendita];

