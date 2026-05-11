SELECT [Sales Line].[Document No_], [Sales Line].Type, [Sales Line].[Line No_], [NavisionEan-step0].[Item No_], [NavisionEan-step0].[Cross-Reference No_], Item.[Model Item No_], Item_1.Description, Item_1.[Description 2], [Sales Line].[Variable Code 01], [Sales Line].[Variable Code 02], Val([quantity]) AS qty
FROM (([Sales Line] INNER JOIN [NavisionEan-step0] ON [Sales Line].No_ = [NavisionEan-step0].[Item No_]) INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_
WHERE ((([Sales Line].[Document No_])="FVP-13-00679") AND (([Sales Line].Type)=2));

