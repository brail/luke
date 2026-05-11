UPDATE [Sales Header] INNER JOIN (Item INNER JOIN [Sales Line] ON Item.No_ = [Sales Line].No_) ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type]) SET [Sales Header].[Location Code] = "SPMAG", [Sales Line].[Location Code] = "SPMAG"
WHERE (((Item.[Season Code])="E25") AND ((Item.[Trademark Code])="AP"));

