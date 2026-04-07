SELECT [Item Cross Reference].[Item No_], Item.[trademark code], Item.[season code], [Item Cross Reference].[Cross-Reference No_], [Item Cross Reference].[VARIABLE CODE 01], [Item Cross Reference].[VARIABLE CODE 02]
FROM Item INNER JOIN [Item Cross Reference] ON Item.No_ = [Item Cross Reference].[Item No_]
WHERE (((Item.[trademark code])="GANT") AND ((Item.[season code])="E20"));

