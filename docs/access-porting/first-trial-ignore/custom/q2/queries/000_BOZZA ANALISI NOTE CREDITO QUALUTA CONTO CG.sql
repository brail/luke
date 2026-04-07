SELECT [Sales Cr_Memo Line].[Document No_], [Sales Cr_Memo Line].No_, [Sales Cr_Memo Line].Description, [Sales Cr_Memo Header].[Shortcut Dimension 2 Code], [Sales Cr_Memo Line].Type, [Sales Cr_Memo Header].[Posting Date], Val([AMOUNT]) AS VALORE
FROM [Sales Cr_Memo Line] INNER JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_
WHERE ((([Sales Cr_Memo Line].No_)="R0100200") AND (([Sales Cr_Memo Header].[Shortcut Dimension 2 Code])="NAPA") AND (([Sales Cr_Memo Line].Type)=1) AND (([Sales Cr_Memo Header].[Posting Date]) Between #10/1/2021# And #3/21/2022#));

