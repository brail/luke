SELECT ListinoVenditaRetailRaggruppato_step0.[model item no_], ListinoVenditaRetailRaggruppato_step0.[variable code 01], ListinoVenditaRetailRaggruppato_step0.Concat, Max(append(Format$([listino],"#.00"),[concat],0)) AS ListinoRetail
FROM ListinoVenditaRetailRaggruppato_step0
GROUP BY ListinoVenditaRetailRaggruppato_step0.[model item no_], ListinoVenditaRetailRaggruppato_step0.[variable code 01], ListinoVenditaRetailRaggruppato_step0.Concat
ORDER BY ListinoVenditaRetailRaggruppato_step0.Concat;

