SELECT [Sales Header].[Sell-to Customer No_] AS CodiceCliente, [Sales Header].No_ AS NumeroOrdine, [Sales Header.No_]+":"+[Comment] AS Commento, [Sales Comment Line].[Line No_] AS OrdinamentoCommento
FROM [Sales Header] INNER JOIN [Sales Comment Line] ON ([Sales Header].No_ = [Sales Comment Line].No_) AND ([Sales Header].[Document Type] = [Sales Comment Line].[Document Type])
WHERE ((([Sales Header].[Document Type])=1));

