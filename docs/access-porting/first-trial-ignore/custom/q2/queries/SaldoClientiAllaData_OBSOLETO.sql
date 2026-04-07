SELECT Customer.No_, Customer.Name, [Detailed Cust_ Ledg_ Entry].[Currency Code], Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])) AS ImportoResiduoInValuta, Sum(Val([Detailed Cust_ Ledg_ Entry.Amount (LCY)])) AS ImportoResiduoEuro
FROM [Detailed Cust_ Ledg_ Entry] INNER JOIN ([Cust_ Ledger Entry] INNER JOIN Customer ON [Cust_ Ledger Entry].[Customer No_] = Customer.No_) ON [Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_] = [Cust_ Ledger Entry].[Entry No_]
WHERE ((([Detailed Cust_ Ledg_ Entry].[Posting Date])<=[forms]![principale]![datafinale]))
GROUP BY Customer.No_, Customer.Name, [Detailed Cust_ Ledg_ Entry].[Currency Code]
HAVING (((Sum(Val([Detailed Cust_ Ledg_ Entry.Amount])))<>0) AND ((Sum(Val([Detailed Cust_ Ledg_ Entry.Amount (LCY)])))<>0));

