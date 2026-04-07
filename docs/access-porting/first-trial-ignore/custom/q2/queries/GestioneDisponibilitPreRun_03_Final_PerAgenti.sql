SELECT GestioneDisponibilitPreRun_01_Acquisti.No_, GestioneDisponibilitPreRun_01_Acquisti.[constant variable code] AS Color, GestioneDisponibilitPreRun_01_Acquisti.[assortment code], [buy_qty]-Nz([sal_qty]) AS disp_qty
FROM GestioneDisponibilitPreRun_02_Vendite RIGHT JOIN GestioneDisponibilitPreRun_01_Acquisti ON (GestioneDisponibilitPreRun_02_Vendite.[assortment code] = GestioneDisponibilitPreRun_01_Acquisti.[assortment code]) AND (GestioneDisponibilitPreRun_02_Vendite.[constant variable code] = GestioneDisponibilitPreRun_01_Acquisti.[constant variable code]) AND (GestioneDisponibilitPreRun_02_Vendite.No_ = GestioneDisponibilitPreRun_01_Acquisti.No_)
WHERE (((IIf([buy_qty]-Nz([sal_qty])>0,"","XXX"))=""));

