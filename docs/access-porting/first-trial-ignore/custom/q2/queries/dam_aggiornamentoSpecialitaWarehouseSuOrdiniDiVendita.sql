UPDATE [Sales Header Extension] INNER JOIN [Sales Header] ON ([Sales Header Extension].[Document No_] = [Sales Header].No_) AND ([Sales Header Extension].[Document Type] = [Sales Header].[Document Type]) SET [Sales Header Extension].[Warehouse Speciality Code] = "DED"
WHERE ((([Sales Header].[Shortcut Dimension 2 Code])="BEPOSITIVE" Or ([Sales Header].[Shortcut Dimension 2 Code])="BLAC") AND (([Sales Header].[selling season code])="I25"));

