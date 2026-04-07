UPDATE [Sales Header] INNER JOIN [Sales Line] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type]) SET [Sales Header].[Location Code] = "DBG", [Sales Line].[Location Code] = "DBG"
WHERE ((([Sales Header].[Shortcut Dimension 2 Code])="BLAC") AND (([Sales Header].[Selling Season Code])="E24"));

