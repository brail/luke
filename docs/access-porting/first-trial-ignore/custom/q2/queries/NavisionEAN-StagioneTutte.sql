SELECT [NavisionEan-step0].[Item No_], [NavisionEan-step0].[Cross-Reference Type], [NavisionEan-step0].[Cross-Reference No_], Item.[Country_region of Origin Code], Item.[Tariff No_], Item.[Net Weight], Item.[Gross Weight], Item.No_, Item.[Model Item No_] AS Article, Item_1.Description, Item_1.[Description 2], Item.[Variable Code 01] AS Color, Item.[Variable Code 02] AS [Size], Item.[Season Code], Item.[Trademark Code], Item.[Sales_Purchase Status - Item], Item.[Configurator Relation]
FROM (Item LEFT JOIN [NavisionEan-step0] ON Item.No_ = [NavisionEan-step0].[Item No_]) LEFT JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_
WHERE (((Item.[Configurator Relation])=3));

