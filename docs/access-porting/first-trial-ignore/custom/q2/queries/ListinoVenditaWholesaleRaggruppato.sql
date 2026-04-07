SELECT ListinoVenditaWholesaleRaggruppato_step0.[model item no_], ListinoVenditaWholesaleRaggruppato_step0.[variable code 01], Concat, Max(append(Format$([listino],"#.00"),[concat],0)) AS ListinoWholesale
FROM ListinoVenditaWholesaleRaggruppato_step0
GROUP BY ListinoVenditaWholesaleRaggruppato_step0.[model item no_], ListinoVenditaWholesaleRaggruppato_step0.[variable code 01], Concat
ORDER BY Concat;

