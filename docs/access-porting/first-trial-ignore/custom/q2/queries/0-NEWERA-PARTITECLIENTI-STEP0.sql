SELECT Sum(Val([Amount])) AS importo, [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_], Abs(Sum(Val([amount]))) AS [check]
FROM [Detailed Cust_ Ledg_ Entry]
GROUP BY [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_]
HAVING (((Abs(Sum(Val([amount]))))>0.00001));

