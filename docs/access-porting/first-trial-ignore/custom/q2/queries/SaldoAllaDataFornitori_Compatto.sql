SELECT Sum(Val([Detailed Vendor Ledg_ Entry.Amount])) AS SaldoD, Sum(Val([Detailed Vendor Ledg_ Entry.Amount (LCY)])) AS SaldoVL
FROM [Detailed Vendor Ledg_ Entry] INNER JOIN Vendor ON [Detailed Vendor Ledg_ Entry].[Vendor No_] = Vendor.No_
WHERE ((([Detailed Vendor Ledg_ Entry].[Posting Date])<=[data]))
HAVING (((Abs((Sum(Val([Detailed Vendor Ledg_ Entry.Amount (LCY)])))))>0.01));

