SELECT Customer.No_, Customer.Name, Customer.[Name 2], Customer.Address, Customer.[Post Code], Customer.City, Customer.County, Customer.[Country_region Code], Customer.[VAT Registration No_], Customer.[Fiscal Code], Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])) AS SaldoD
FROM [Detailed Cust_ Ledg_ Entry] INNER JOIN Customer ON [Detailed Cust_ Ledg_ Entry].[Customer No_] = Customer.No_
WHERE ((([Detailed Cust_ Ledg_ Entry].[Posting Date])<=[forms]![principale]![datafinale]))
GROUP BY Customer.No_, Customer.Name, Customer.[Name 2], Customer.Address, Customer.[Post Code], Customer.City, Customer.County, Customer.[Country_region Code], Customer.[VAT Registration No_], Customer.[Fiscal Code]
HAVING (((Abs((Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])))))>0.01));

