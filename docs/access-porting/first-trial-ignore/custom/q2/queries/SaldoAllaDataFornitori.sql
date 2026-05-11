SELECT Vendor.No_, Vendor.Name, Vendor.[Name 2], Vendor.Address, Vendor.[Post Code], Vendor.City, Vendor.County, Vendor.[Country_region Code], Vendor.[VAT Registration No_], Vendor.[Fiscal Code], [Detailed Vendor Ledg_ Entry].[Currency Code], Sum(Val([Detailed Vendor Ledg_ Entry.Amount])) AS SaldoD, Sum(Val([Detailed Vendor Ledg_ Entry.Amount (LCY)])) AS SaldoVL
FROM [Detailed Vendor Ledg_ Entry] INNER JOIN Vendor ON [Detailed Vendor Ledg_ Entry].[Vendor No_] = Vendor.No_
WHERE ((([Detailed Vendor Ledg_ Entry].[Posting Date])<=[forms]![principale]![datafinale]))
GROUP BY Vendor.No_, Vendor.Name, Vendor.[Name 2], Vendor.Address, Vendor.[Post Code], Vendor.City, Vendor.County, Vendor.[Country_region Code], Vendor.[VAT Registration No_], Vendor.[Fiscal Code], [Detailed Vendor Ledg_ Entry].[Currency Code]
HAVING (((Abs((Sum(Val([Detailed Vendor Ledg_ Entry.Amount (LCY)])))))>0.01));

