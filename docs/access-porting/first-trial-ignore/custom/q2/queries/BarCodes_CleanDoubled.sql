SELECT [Item Cross Reference].[Cross-Reference No_], [Item Cross Reference].[Cross-Reference Type], Max([Item Cross Reference].[Item No_]) AS [MaxDiItem No_]
FROM [Item Cross Reference]
WHERE ((([Item Cross Reference].[Cross-Reference Type No_])="EAN13" Or ([Item Cross Reference].[Cross-Reference Type No_])="UPC"))
GROUP BY [Item Cross Reference].[Cross-Reference No_], [Item Cross Reference].[Cross-Reference Type];

