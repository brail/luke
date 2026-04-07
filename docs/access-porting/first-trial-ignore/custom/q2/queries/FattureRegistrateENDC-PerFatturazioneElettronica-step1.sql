SELECT [Sales Cr_Memo Header].[Sell-to Customer No_], Customer.Name, ([Sales Cr_memo header].[No_]) AS DocumentNo_, [Sales Cr_Memo header.Posting Date] AS DataFattura, Sum(Val([Sales Cr_Memo Line.Quantity])) AS qtyInvoiced, Sum(Val([sales Cr_memo line.Amount])) AS Amount_, Sum(Val([Sales Cr_memo Line.Line Discount Amount])) AS LineDiscountAmount, Sum(Val([Sales Cr_memo Line.Line Amount])) AS LineAmount, Sum(Val([Sales Cr_Memo Line.Inv_ Discount Amount])) AS InvoiceDiscountAmountu, Sum(Val([Amount Including VAT])) AS AmountWithVAT
FROM ([Sales Cr_Memo Header] LEFT JOIN Customer ON [Sales Cr_Memo Header].[Sell-to Customer No_] = Customer.No_) LEFT JOIN [Sales Cr_Memo Line] ON [Sales Cr_Memo Header].No_ = [Sales Cr_Memo Line].[Document No_]
WHERE ((([Sales Cr_Memo Line].TYPE)=2 Or ([Sales Cr_Memo Line].TYPE)=1))
GROUP BY [Sales Cr_Memo Header].[Sell-to Customer No_], Customer.Name, ([Sales Cr_memo header].[No_]), [Sales Cr_Memo header.Posting Date]
HAVING ((([Sales Cr_Memo header.Posting Date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]));

