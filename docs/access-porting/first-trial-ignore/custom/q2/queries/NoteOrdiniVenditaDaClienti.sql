SELECT [Comment Line].No_ AS CodiceCliente, "CLI: "+[Comment] AS Commento, 1000000+[Line No_] AS OrdinamentoCommento
FROM [Comment Line]
WHERE ((([Comment Line].[Table Name])=1));

