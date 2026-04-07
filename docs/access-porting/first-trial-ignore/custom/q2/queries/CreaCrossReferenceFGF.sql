INSERT INTO [Cross-Reference Model Item] ( [Model Item No_], [Cross-Reference Type], [Cross-Reference Type No_], [Constant Variable Code], [Cross-Reference No_], [Constant Assortment Var_Grp_], [Variable Code 01], [Variable Code 02], [Variable Group 01], [Variable Group 02] )
SELECT TranscodificaFGF.No_, 1 AS Espr1, "C02960" AS Espr2, TranscodificaFGF.ColorCode, [mODELLO] & "_" & [PARTE] & "_" & [COLORE_FGF] AS Espr3, Item.[Constant Assortment Var_Grp_], "" AS Espr4, "" AS Espr5, "" AS Espr6, "" AS Espr7
FROM TranscodificaFGF INNER JOIN Item ON TranscodificaFGF.No_ = Item.No_;

