SELECT Item.No_, Item.Description, Item.[Description 2], Item.[Assortment Variable Group], Item.[Trademark Code], Item.[Season Code], Item.[Collection Code], Item.[Line Code]
FROM Item
WHERE (((Item.No_) Not Like 'TEMP%') AND ((Item.[Configurator Relation])=1));

