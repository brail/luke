SELECT Customer.[country_region code], [Sales Invoice Header].No_, [Sales Invoice Header].[Sell-to Customer No_], [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].[posting date], Val([Sales Invoice Header.net weight]) AS NettoFattura, Val([Sales Invoice Header.gross weight]) AS LordoFattura, Sum(Val([sales invoice line.amount])) AS importo
FROM ([Sales Invoice Line] INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_) INNER JOIN Customer ON [Sales Invoice Header].[Bill-to Customer No_] = Customer.No_
WHERE ((([Sales Invoice Line].Type)<>19 And ([Sales Invoice Line].Type)<>20))
GROUP BY Customer.[country_region code], [Sales Invoice Header].No_, [Sales Invoice Header].[Sell-to Customer No_], [Sales Invoice Header].[Bill-to Customer No_], [Sales Invoice Header].[Bill-to Name], [Sales Invoice Header].[posting date], Val([Sales Invoice Header.net weight]), Val([Sales Invoice Header.gross weight])
HAVING (((Customer.[country_region code])="DE"));

