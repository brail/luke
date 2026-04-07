SELECT ListinoVenditaWholesale.[Sales Code], Item.[model item no_], Item.[variable code 01], ListinoVenditaWholesale.Listino, Item.[trademark code], [item.model item no_] & "_" & [item.variable code 01] AS concat
FROM ListinoVenditaWholesale INNER JOIN Item ON ListinoVenditaWholesale.[Item No_] = Item.No_
GROUP BY ListinoVenditaWholesale.[Sales Code], Item.[model item no_], Item.[variable code 01], ListinoVenditaWholesale.Listino, Item.[trademark code], [item.model item no_] & "_" & [item.variable code 01];

