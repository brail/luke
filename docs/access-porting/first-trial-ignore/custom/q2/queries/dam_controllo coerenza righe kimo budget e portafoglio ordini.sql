SELECT [Sales Header].[Document Type], [Sales Header].No_, [Sales Header].[Bill-to Name], [Sales Header].[Budget No_], [Budget Line].[Budget No_], [Sales Header].[selling season code], [Sales Header].[Shortcut Dimension 1 Code], [Sales Header].[Shortcut Dimension 2 Code]
FROM [Sales Header] LEFT JOIN [Budget Line] ON ([Sales Header].[Sell-to Customer No_] = [Budget Line].[Source No_]) AND ([Sales Header].[Budget No_] = [Budget Line].[Budget No_])
WHERE ((([Sales Header].[Budget No_])<>"") AND (([Budget Line].[Budget No_]) Is Null) AND (([Sales Header].[selling season code])="E22"));

