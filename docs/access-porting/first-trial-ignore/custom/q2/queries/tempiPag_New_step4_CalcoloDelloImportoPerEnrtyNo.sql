SELECT [Cust_ Ledger Entry].[Document Type], [Cust_ Ledger Entry].[Entry No_], Round(Sum(IIf([entry type]=1 Or [entry type]=3 Or [entry type]=4 Or [entry type]=5 Or [entry type]=6 Or [entry type]=7 Or [entry type]=8 Or [entry type]=9 Or [entry type]=12 Or [entry type]=13 Or [entry type]=14 Or [entry type]=15 Or [entry type]=16 Or [entry type]=17,Val([Amount]),0))*10000)/10000 AS Importo, Round(Sum(Val([Amount]))*10000)/10000 AS ImportoResiduo
FROM [Cust_ Ledger Entry] INNER JOIN [Detailed Cust_ Ledg_ Entry] ON [Cust_ Ledger Entry].[Entry No_] = [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_]
GROUP BY [Cust_ Ledger Entry].[Document Type], [Cust_ Ledger Entry].[Entry No_]
HAVING ((([Cust_ Ledger Entry].[Document Type])=2 Or ([Cust_ Ledger Entry].[Document Type])=3));

