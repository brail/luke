SELECT Item.[Season Code], Item.[Trademark Code], [NavisionEan-step0].[Cross-Reference No_] AS SKU, [Item.Model Item No_] & "_" & [Item.Variable Code 01] & "_" & [Item.Variable Code 02] & " " & [item_1.Description] AS Description, Val([item.net weight]) AS weight
FROM (Item INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_) LEFT JOIN [NavisionEan-step0] ON Item.No_ = [NavisionEan-step0].[Item No_]
WHERE (((Item.[Season Code])=[forms]![principale]![FiltroStagioneSourcing]) AND ((Item.[Trademark Code])=[forms]![principale]![FiltroMarchioSourcing]) AND ((Item.[Sales_Purchase Status - Item])=""));

