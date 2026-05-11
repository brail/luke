SELECT Count([Item Cross Reference].[Item No_]) AS [ConteggioDiItem No_], [Item Cross Reference].[Cross-Reference No_]
FROM [Item Cross Reference]
GROUP BY [Item Cross Reference].[Cross-Reference No_]
HAVING (((Count([Item Cross Reference].[Item No_]))>1));

