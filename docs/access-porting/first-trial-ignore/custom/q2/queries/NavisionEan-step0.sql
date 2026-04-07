SELECT [Item Cross Reference].[Item No_], [Item Cross Reference].[Cross-Reference Type], [Item Cross Reference].[Cross-Reference No_]
FROM [Item Cross Reference]
WHERE ((([Item Cross Reference].[Cross-Reference Type])=3) AND (([Item Cross Reference].[Cross-Reference Type No_])="EAN13"));

