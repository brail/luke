SELECT Val([Subject 1 Commission _]) AS royalry_, [Sales Invoice Header].[Subject 1], Salesperson_Purchaser.Name, [Sales Invoice Header].[posting date], [Sales Invoice Header].[Shortcut Dimension 2 Code], [Sales Invoice Line].[Shortcut Dimension 1 Code], [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], Sum(Val([amount])) AS amt
FROM ([Sales Invoice Header] INNER JOIN [Sales Invoice Line] ON [Sales Invoice Header].No_ = [Sales Invoice Line].[Document No_]) LEFT JOIN Salesperson_Purchaser ON [Sales Invoice Header].[Subject 1] = Salesperson_Purchaser.Code
WHERE ((([Sales Invoice Line].Type)=1 Or ([Sales Invoice Line].Type)=2))
GROUP BY Val([Subject 1 Commission _]), [Sales Invoice Header].[Subject 1], Salesperson_Purchaser.Name, [Sales Invoice Header].[posting date], [Sales Invoice Header].[Shortcut Dimension 2 Code], [Sales Invoice Line].[Shortcut Dimension 1 Code], [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name]
HAVING ((([Sales Invoice Header].[posting date]) Between #1/1/2022# And #12/31/2022#) AND (([Sales Invoice Header].[Shortcut Dimension 2 Code])="BLAUER"));

