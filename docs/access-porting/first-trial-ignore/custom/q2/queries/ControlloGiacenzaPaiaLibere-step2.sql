SELECT [Item No_], -quantita as paia, [Location Code]
FROM [ControlloGiacenzaPaiaLibere-step0];

UNION ALL SELECT [Item No_], quantita, [Location Code]
FROM [ControlloGiacenzaPaiaLibere-step1];

