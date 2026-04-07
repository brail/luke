SELECT [Item No_], [Location Code], qty
FROM [InventarioAllaData-step0-pre-tot];

UNION ALL SELECT [Item No_], [Location Code], -qty
FROM [InventarioAllaData-step0-pre-assort];

