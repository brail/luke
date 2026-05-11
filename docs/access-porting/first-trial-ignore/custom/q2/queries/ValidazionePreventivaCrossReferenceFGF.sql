SELECT Item.No_ AS TestArticoloNav, TranscodificaFGF.No_, 1 AS Espr1, "C02960" AS Espr2, TranscodificaFGF.ColorCode, [mODELLO] & "_" & [PARTE] & "_" & [COLORE_FGF] AS Espr3, Item.[Constant Assortment Var_Grp_], "" AS Espr4, "" AS Espr5, "" AS Espr6, "" AS Espr7
FROM TranscodificaFGF LEFT JOIN Item ON TranscodificaFGF.No_ = Item.No_;

