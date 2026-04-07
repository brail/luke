SELECT [Sales Cr_Memo Header].[Bill-to Name], [Sales Cr_Memo Header].No_, [Sales Cr_Memo Line].Type, [Sales Cr_Memo Line].[VAT Identifier], [Sales Cr_Memo Header].[posting date], Sum(Val([Amount])) AS Importo, [Sales Cr_Memo Header].[currency code]
FROM [Sales Cr_Memo Line] INNER JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_
GROUP BY [Sales Cr_Memo Header].[Bill-to Name], [Sales Cr_Memo Header].No_, [Sales Cr_Memo Line].Type, [Sales Cr_Memo Line].[VAT Identifier], [Sales Cr_Memo Header].[posting date], [Sales Cr_Memo Header].[currency code]
HAVING ((([Sales Cr_Memo Line].Type)<>19 And ([Sales Cr_Memo Line].Type)<>0 And ([Sales Cr_Memo Line].Type)<>20) AND (([Sales Cr_Memo Header].[posting date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]))
ORDER BY [Sales Cr_Memo Header].[posting date];

