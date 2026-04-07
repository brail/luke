SELECT [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].No_, [Sales Invoice Line].Type, [Sales Invoice Line].[VAT Identifier], [Sales Invoice Header].[posting date], Sum(Val([Amount])) AS Importo, [Sales Invoice Header].[currency code]
FROM [Sales Invoice Line] INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_
GROUP BY [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].No_, [Sales Invoice Line].Type, [Sales Invoice Line].[VAT Identifier], [Sales Invoice Header].[posting date], [Sales Invoice Header].[currency code]
HAVING ((([Sales Invoice Line].Type)<>19 And ([Sales Invoice Line].Type)<>0 And ([Sales Invoice Line].Type)<>20) AND (([Sales Invoice Header].[posting date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]))
ORDER BY [Sales Invoice Header].[posting date];

