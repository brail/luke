SELECT Item_1.No_, Item_1.Description, Item_1.[Description 2], Item_1.[Assortment Variable Group], Item.[Trademark Code], Item.[Season Code], Item.[Collection Code], Item.[Line Code], Item.[Variable code 01] AS CODCOLOR, "" AS DESCCOLOR
FROM Item LEFT JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_
GROUP BY Item_1.No_, Item_1.Description, Item_1.[Description 2], Item_1.[Assortment Variable Group], Item.[Trademark Code], Item.[Season Code], Item.[Collection Code], Item.[Line Code], Item.[Configurator Relation], Item.[Variable code 01]
HAVING (((Item_1.No_) Not Like 'TEMP%') AND ((Item.[Configurator Relation])=3));

