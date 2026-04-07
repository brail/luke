SELECT "NAV" AS CAT, [trademark code], [season code], [line code],EAN, model, [description 2], color, size, [Location Code], -paia_ AS PAIA, -(PAIA_-PAIABOLLA) AS PAIALIBERE
FROM [ControlloGiacenzaPaiaLibere-step3];

UNION ALL SELECT "INV" AS CAT, [trademark code], [season code], [line code], EAN,  model, [description 2], color, size, [Location Code], paia, PAIALIBERE
FROM [ControlloGiacenzaPaiaLibere-step4];

