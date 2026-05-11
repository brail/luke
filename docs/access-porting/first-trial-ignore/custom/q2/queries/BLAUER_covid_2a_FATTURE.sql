SELECT [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], Sum(Val([Amount])) AS Importo, [Sales Invoice Header].[selling season code], [Sales Invoice Header].[Shortcut Dimension 2 Code] AS Marchio, [Sales Invoice Line].Type, "FATT" AS TIPO
FROM [Sales Invoice Line] INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_
GROUP BY [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].[selling season code], [Sales Invoice Header].[Shortcut Dimension 2 Code], [Sales Invoice Line].Type, "FATT"
HAVING ((([Sales Invoice Header].[selling season code])="E20") AND (([Sales Invoice Header].[Shortcut Dimension 2 Code])="BLAUER") AND (([Sales Invoice Line].Type)=1 Or ([Sales Invoice Line].Type)=2));

