SELECT Item.[Net Weight], Item.[Gross Weight], Val([net weight]) AS netto, Val([gross weight]) AS lordo, Item.[model item No_], Item.[Trademark Code], Item.[Season Code], Item.[Configurator Relation], Item.[Sales_Purchase Status - Item], Item.[Product Family]
FROM Item
GROUP BY Item.[Net Weight], Item.[Gross Weight], Val([net weight]), Val([gross weight]), Item.[model item No_], Item.[Trademark Code], Item.[Season Code], Item.[Configurator Relation], Item.[Sales_Purchase Status - Item], Item.[Product Family]
HAVING (((Item.[Configurator Relation])=3) AND ((Item.[Sales_Purchase Status - Item])=""));

