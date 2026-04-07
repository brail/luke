SELECT "Journal" AS WELineType, [Warehouse Entry].[Item No_], [Warehouse Entry].[Constant Variable Code], [Warehouse Entry].[Assortment Code], [Warehouse Entry].[Journal Batch Name] AS TestataWE, [Warehouse Entry].[Line No_] AS RigaWE, Sum(Val([QUANTITY])) AS QTY
FROM [Warehouse Entry]
GROUP BY "Journal", [Warehouse Entry].[Item No_], [Warehouse Entry].[Constant Variable Code], [Warehouse Entry].[Assortment Code], [Warehouse Entry].[Journal Batch Name], [Warehouse Entry].[Line No_]
HAVING ((([Warehouse Entry].[Journal Batch Name])<>"") AND (([Warehouse Entry].[Line No_])<>111111) AND ((Sum(Val([QUANTITY])))<>0));

