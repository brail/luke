SELECT ListinoVenditaRetail.[Sales Code], Item.[model item no_], Item.[variable code 01], ListinoVenditaRetail.Listino, Item.[trademark code], [item.model item no_] & "_" & [item.variable code 01] AS concat
FROM ListinoVenditaRetail INNER JOIN Item ON ListinoVenditaRetail.[Item No_] = Item.No_
GROUP BY ListinoVenditaRetail.[Sales Code], Item.[model item no_], Item.[variable code 01], ListinoVenditaRetail.Listino, Item.[trademark code], [item.model item no_] & "_" & [item.variable code 01];

