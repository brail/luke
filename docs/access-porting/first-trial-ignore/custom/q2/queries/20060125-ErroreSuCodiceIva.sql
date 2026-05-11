SELECT [Sales Line].[Document No_], [Sales Line].Type, [Sales Line].[VAT Identifier], [Sales Line_1].[VAT Identifier], [Sales Line_1].[Line No_], [Sales Line_1].No_, [Sales Line].No_
FROM [Sales Line] INNER JOIN [Sales Line] AS [Sales Line_1] ON ([Sales Line_1].[Original Line No_] = [Sales Line].[Line No_]) AND ([Sales Line].[Document No_] = [Sales Line_1].[Document No_]) AND ([Sales Line].[Document Type] = [Sales Line_1].[Document Type])
WHERE ((([Sales Line].Type)=19 Or ([Sales Line].Type)=20) AND (([Sales Line].[VAT Identifier])<>[Sales Line_1].[vat identifier]));

