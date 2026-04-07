SELECT Sum(Val([Purch_ Cr_ Memo Line.amount])) AS Amount_, [Purch_ Cr_ Memo Line].[Buy-from Vendor No_], Vendor.Name, [Purch_ Cr_ Memo Line].[Shortcut Dimension 2 Code], [Purch_ Cr_ Memo Hdr_].No_ AS InvoiceNo, [Purch_ Cr_ Memo Hdr_].[currency code], [Purch_ Cr_ Memo Hdr_].[posting date] AS DataFattura
FROM ([Purch_ Cr_ Memo Line] INNER JOIN [Purch_ Cr_ Memo Hdr_] ON [Purch_ Cr_ Memo Line].[Document No_] = [Purch_ Cr_ Memo Hdr_].No_) INNER JOIN Vendor ON [Purch_ Cr_ Memo Line].[Buy-from Vendor No_] = Vendor.No_
WHERE ((([Purch_ Cr_ Memo Line].Type)<>19 And ([Purch_ Cr_ Memo Line].Type)<>20 And ([Purch_ Cr_ Memo Line].Type)<>0))
GROUP BY [Purch_ Cr_ Memo Line].[Buy-from Vendor No_], Vendor.Name, [Purch_ Cr_ Memo Line].[Shortcut Dimension 2 Code], [Purch_ Cr_ Memo Hdr_].No_, [Purch_ Cr_ Memo Hdr_].[currency code], [Purch_ Cr_ Memo Hdr_].[posting date]
HAVING ((([Purch_ Cr_ Memo Hdr_].[posting date]) Between [Forms]![Principale]![DataIniziale] And [Forms]![Principale]![DataFinale]));

