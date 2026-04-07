SELECT Item.[Trademark Code], Item.[Season Code], Item.[Product Sex], Item.[Line Code], Item.No_, Item.[Variable Code 01] AS Color, "" AS [Assortment Code], Item.[Variable Code 02], Item.[Sales_Purchase Status - Item]
FROM Item
WHERE (((Item.[Configurator Relation])=3))
GROUP BY Item.[Trademark Code], Item.[Season Code], Item.[Product Sex], Item.[Line Code], Item.No_, Item.[Variable Code 01], Item.[Variable Code 02], Item.[Sales_Purchase Status - Item]
HAVING (((Item.[Line Code])<>""))
ORDER BY Item.[Trademark Code], Item.[Season Code], Item.[Line Code], Item.No_, Item.[Variable Code 01], Item.[Variable Code 02];

