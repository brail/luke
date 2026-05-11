SELECT [Cust_ Ledger Entry].[Entry No_], [Cust_ Ledger Entry].[Customer No_], [Cust_ Ledger Entry].[Posting Date], [Cust_ Ledger Entry].[Document No_], [Cust_ Ledger Entry].[Due Date], Sum(Val([Amount])) AS rem_Amount
FROM [Detailed Cust_ Ledg_ Entry] INNER JOIN [Cust_ Ledger Entry] ON [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_] = [Cust_ Ledger Entry].[Entry No_]
GROUP BY [Cust_ Ledger Entry].[Entry No_], [Cust_ Ledger Entry].[Customer No_], [Cust_ Ledger Entry].[Posting Date], [Cust_ Ledger Entry].[Document No_], [Cust_ Ledger Entry].[Due Date]
HAVING ((([Cust_ Ledger Entry].[Customer No_])="C00302") AND (([Cust_ Ledger Entry].[Due Date])=#12/31/2023#));

