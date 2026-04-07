SELECT [Sales Line].[Document No_] AS OrdineNr, [Sales Line].[Line No_] AS LineaNr, [Sales Line].[Variable Code 02] AS taglia, Val([quantity]) AS quantitaTaglia, [Sales Line].[Original Line No_] AS LineaOriginaleNr
FROM [Sales Line];

