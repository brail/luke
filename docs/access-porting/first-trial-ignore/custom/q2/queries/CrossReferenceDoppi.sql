SELECT [CrossReferenceDoppi-Step0].[Cross-Reference No_], Item_1.No_, Item_1.Description, Item_1.[Description 2], Item.[Variable Code 01] AS Colore, Item.[Variable Code 02] AS Taglia
FROM (([CrossReferenceDoppi-Step0] INNER JOIN [Item Cross Reference] ON [CrossReferenceDoppi-Step0].[Cross-Reference No_] = [Item Cross Reference].[Cross-Reference No_]) INNER JOIN Item ON [Item Cross Reference].[Item No_] = Item.No_) INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_
ORDER BY [CrossReferenceDoppi-Step0].[Cross-Reference No_], Item_1.No_, Item.[Variable Code 01], Item.[Variable Code 02];

