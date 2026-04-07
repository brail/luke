SELECT [Sales Cr_Memo Header].No_, [Sales Cr_Memo Header].NSP_Capozona, [Sales Cr_Memo Line].NSP_PercentualeCapozona, Item.[Season Code], Item.[Trademark Code], [Sales Cr_Memo Header].NSP_Subject1, Val([NSP_PercentualeSubject1]) AS Provv, [Sales Cr_Memo Line].Type, [Sales Cr_Memo Line].Description, [Sales Cr_Memo Header].[Posting Date]
FROM ([Sales Cr_Memo Line] RIGHT JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_) LEFT JOIN Item ON [Sales Cr_Memo Line].No_ = Item.No_
WHERE (((Val([NSP_PercentualeSubject1]))<>12) AND (([Sales Cr_Memo Line].Type)<>0 And ([Sales Cr_Memo Line].Type)=1) AND (([Sales Cr_Memo Header].[Posting Date])>#6/1/2015#));

