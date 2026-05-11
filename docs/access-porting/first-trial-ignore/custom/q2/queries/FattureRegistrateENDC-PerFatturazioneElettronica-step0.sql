SELECT [Sales Invoice Header].[Sell-to Customer No_], Customer.Name, ([Sales invoice header].[No_]) AS DocumentNo_, [Sales invoice header.Posting Date] AS DataFattura, Sum(Val([Sales Invoice Line.Quantity])) AS qtyInvoiced, Sum(Val([sales invoice line.Amount])) AS Amount_, Sum(Val([Sales Invoice Line.Line Discount Amount])) AS LineDiscountAmount, Sum(Val([Sales Invoice Line.Line Amount])) AS LineAmount, Sum(Val([Sales Invoice Line.Inv_ Discount Amount])) AS InvoiceDiscountAmountu, Sum(Val([Amount Including VAT])) AS AmountWithVAT
FROM ([Sales Invoice Line] RIGHT JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_) LEFT JOIN Customer ON [Sales Invoice Header].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Invoice Line].Type)=2 Or ([Sales Invoice Line].Type)=1))
GROUP BY [Sales Invoice Header].[Sell-to Customer No_], Customer.Name, ([Sales invoice header].[No_]), [Sales invoice header.Posting Date]
HAVING ((([Sales invoice header.Posting Date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]));

