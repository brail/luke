SELECT [Sales Header].[Sell-to Customer No_] AS CodiceCliente, [Sales Header].No_ AS NumeroOrdine, [Sales Comment Line].Comment AS Commento, [Sales Comment Line].[Line No_] AS OrdinamentoCommento, [Sales Comment Line].Code
FROM [Sales Header] INNER JOIN [Sales Comment Line] ON ([Sales Header].No_ = [Sales Comment Line].No_) AND ([Sales Header].[Document Type] = [Sales Comment Line].[Document Type])
WHERE ((([Sales Comment Line].Code)="cred") AND (([Sales Header].[Document Type])=1))
ORDER BY [Sales Header].No_, [Sales Comment Line].[Line No_];

