SELECT [Detailed Cust_ Ledg_ Entry].[Currency Code], Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])) AS ImportoResiduoInValuta, Sum(Val([Detailed Cust_ Ledg_ Entry.Amount (LCY)])) AS ImportoResiduoEuro, [Cust_ Ledger Entry].[Letter No_]
FROM [Detailed Cust_ Ledg_ Entry] INNER JOIN [Cust_ Ledger Entry] ON [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_] = [Cust_ Ledger Entry].[Entry No_]
GROUP BY [Detailed Cust_ Ledg_ Entry].[Currency Code], [Cust_ Ledger Entry].[Letter No_]
HAVING (((Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])))<>0) AND ((Sum(Val([Detailed Cust_ Ledg_ Entry.Amount (LCY)])))<>0));

