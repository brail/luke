SELECT [Purch_ Rcpt_ Line].[Document No_], [Purch_ Rcpt_ Line].Type, [Purch_ Rcpt_ Line].No_, [Purch_ Rcpt_ Line].[Constant Variable Code], [Purch_ Rcpt_ Line].[season code], [Purch_ Rcpt_ Line].[Posting Date] AS PurchaseOrderReceiptDate, Sum(Val([NO_ OF PAIRS])) AS QTY, [Purch_ Rcpt_ Line].[Order No_], [Purch_ Rcpt_ Line].[Order Line No_]
FROM [Purch_ Rcpt_ Line] INNER JOIN [Purch_ Rcpt_ Header] ON [Purch_ Rcpt_ Line].[Document No_] = [Purch_ Rcpt_ Header].No_
WHERE ((([Purch_ Rcpt_ Header].[location code])="PMAG" Or ([Purch_ Rcpt_ Header].[location code])="SPMAG" Or ([Purch_ Rcpt_ Header].[location code])="DBG"))
GROUP BY [Purch_ Rcpt_ Line].[Document No_], [Purch_ Rcpt_ Line].Type, [Purch_ Rcpt_ Line].No_, [Purch_ Rcpt_ Line].[Constant Variable Code], [Purch_ Rcpt_ Line].[season code], [Purch_ Rcpt_ Line].[Posting Date], [Purch_ Rcpt_ Line].[Order No_], [Purch_ Rcpt_ Line].[Order Line No_]
HAVING ((([Purch_ Rcpt_ Line].Type)=19 Or ([Purch_ Rcpt_ Line].Type)=20) AND (([Purch_ Rcpt_ Line].[season code])=[CODICE STAGIONE]) AND ((Sum(Val([NO_ OF PAIRS])))>0));

