SELECT "Assortito" AS tipo, [Item No_], [Location Code], qty
FROM [inventarioAllaData-step0-pre-assort];

UNION ALL SELECT "Sfuso" AS tipo, [Item No_], [Location Code], qty
FROM [inventarioAllaData-step0-pre-sfuse];

