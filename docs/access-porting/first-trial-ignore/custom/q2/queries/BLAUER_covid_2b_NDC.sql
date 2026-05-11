SELECT [Sales Cr_Memo Header].[Bill-to Customer No_], [Sales Cr_Memo Header].[Bill-to Name], Sum(Val([Amount])) AS Importo, [Sales Cr_Memo Header].[selling season code], [Sales Cr_Memo Header].[Shortcut Dimension 2 Code] AS Marchio, [Sales Cr_Memo Line].Type, "NDC" AS TIPO
FROM [Sales Cr_Memo Line] INNER JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_
GROUP BY [Sales Cr_Memo Header].[Bill-to Customer No_], [Sales Cr_Memo Header].[Bill-to Name], [Sales Cr_Memo Header].[selling season code], [Sales Cr_Memo Header].[Shortcut Dimension 2 Code], [Sales Cr_Memo Line].Type, "NDC"
HAVING ((([Sales Cr_Memo Header].[selling season code])="E20") AND (([Sales Cr_Memo Header].[Shortcut Dimension 2 Code])="BLAUER") AND (([Sales Cr_Memo Line].Type)=1 Or ([Sales Cr_Memo Line].Type)=2));

