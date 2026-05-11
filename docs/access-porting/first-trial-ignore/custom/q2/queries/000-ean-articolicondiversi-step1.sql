SELECT [Item Cross Reference].[Item No_], Count([Item Cross Reference].[Cross-Reference No_]) AS [ConteggioDiCross-Reference No_]
FROM [Item Cross Reference]
GROUP BY [Item Cross Reference].[Item No_]
HAVING (((Count([Item Cross Reference].[Cross-Reference No_]))>1));

