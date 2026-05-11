SELECT [EAC Tabella Per Stampa Unione].NO_, [EAC Tabella Per Stampa Unione].[Variable Code 01], [EAC Tabella Per Stampa Unione].[Variable Code 02], IC_Trade_Taglia.[Article Code]
FROM [EAC Tabella Per Stampa Unione] LEFT JOIN IC_Trade_Taglia ON ([EAC Tabella Per Stampa Unione].NO_ = IC_Trade_Taglia.[Article Code]) AND ([EAC Tabella Per Stampa Unione].[Variable Code 01] = IC_Trade_Taglia.ColorCode) AND ([EAC Tabella Per Stampa Unione].[Variable Code 02] = IC_Trade_Taglia.[РАЗМЕР:])
WHERE (((IC_Trade_Taglia.[Article Code]) Is Null));

