SELECT (Val([Detailed Vendor Ledg_ Entry.Amount])) AS SaldoD, (Val([Detailed Vendor Ledg_ Entry.Amount (LCY)])) AS SaldoVL, [Detailed Vendor Ledg_ Entry].[Posting Date], [Detailed Vendor Ledg_ Entry].[Entry No_], Vendor.Name, [Detailed Vendor Ledg_ Entry].[Document No_]
FROM [Detailed Vendor Ledg_ Entry] INNER JOIN Vendor ON [Detailed Vendor Ledg_ Entry].[Vendor No_] = Vendor.No_
WHERE ((([Detailed Vendor Ledg_ Entry].[Posting Date])=#3/31/2018#));

