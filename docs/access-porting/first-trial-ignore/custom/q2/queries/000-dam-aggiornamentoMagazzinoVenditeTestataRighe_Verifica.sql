SELECT [Sales Header].[Location Code], [Sales Line].[Location Code], Item.[Season Code], Item.[Trademark Code], [Sales Line].[Document No_], [Sales Header].[DOCUMENT DATE], Val([QUANTITY]) AS QTY, [Sales Line].Type
FROM [Sales Header] INNER JOIN (Item INNER JOIN [Sales Line] ON Item.No_ = [Sales Line].No_) ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type])
WHERE (((Item.[Season Code])="E25") AND ((Item.[Trademark Code])="BLAC" Or (Item.[Trademark Code])="AP"));

