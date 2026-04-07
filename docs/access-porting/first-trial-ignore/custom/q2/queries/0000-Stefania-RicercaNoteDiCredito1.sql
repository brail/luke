SELECT [Sales Cr_Memo Header].No_, [Sales Cr_Memo Header].NSP_Capozona, [Sales Cr_Memo Line].NSP_PercentualeCapozona, Item.[Season Code], Item.[Trademark Code], [Sales Cr_Memo Header].NSP_Subject1, Val([NSP_PercentualeSubject1]) AS Provv
FROM ([Sales Cr_Memo Line] RIGHT JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_) LEFT JOIN Item ON [Sales Cr_Memo Line].No_ = Item.No_
WHERE (((Item.[Season Code])="i1516") AND ((Item.[Trademark Code])="ap") AND ((Val([NSP_PercentualeSubject1]))<>12));

