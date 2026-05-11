SELECT [ControlloGiacenzaPaiaLibere-final].CAT, "N" as BOX, [ControlloGiacenzaPaiaLibere-final].[TRADEMARK CODE] AS MARCHJO, [ControlloGiacenzaPaiaLibere-final].[SEASON CODE] AS STAGIONE, [ControlloGiacenzaPaiaLibere-final].MODEL AS ARTIOLO, [ControlloGiacenzaPaiaLibere-final].COLOR AS COLORE, [ControlloGiacenzaPaiaLibere-final].[LOCATION CODE] AS LOCATION, [ControlloGiacenzaPaiaLibere-final].PAIALIBERE AS PAIRS
FROM [ControlloGiacenzaPaiaLibere-final];

UNION ALL select cat, "S" as BOX, marchio_, stagione_, articolo_, colore_, Location_, pairs from confrontogiacenzalogimoda;

