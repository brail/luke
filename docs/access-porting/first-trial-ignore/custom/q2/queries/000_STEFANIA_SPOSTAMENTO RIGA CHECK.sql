SELECT [Cust_ Ledger Entry].[Entry No_], [Cust_ Ledger Entry].[Customer No_], [Cust_ Ledger Entry].[Document No_], Sum(Val([Amount])) AS IMPORTO, [Cust_ Ledger Entry].[Posting Date], [Cust_ Ledger Entry].[Due Date], [Cust_ Ledger Entry].Open
FROM [Detailed Cust_ Ledg_ Entry] INNER JOIN [Cust_ Ledger Entry] ON [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_] = [Cust_ Ledger Entry].[Entry No_]
WHERE ((([Cust_ Ledger Entry].[payment method code])="RIBA"))
GROUP BY [Cust_ Ledger Entry].[Entry No_], [Cust_ Ledger Entry].[Customer No_], [Cust_ Ledger Entry].[Document No_], [Cust_ Ledger Entry].[Posting Date], [Cust_ Ledger Entry].[Due Date], [Cust_ Ledger Entry].Open
HAVING ((([Cust_ Ledger Entry].[Due Date])=#5/31/2020#) AND (([Cust_ Ledger Entry].Open)=1));

