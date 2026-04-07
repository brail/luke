SELECT [Sim_Detailed Cust_ Ledg_ Entry].[Currency Code] AS CodValuta, Sum(Val([Sim_Detailed Cust_ Ledg_ Entry.Amount])) AS ImportoResiduoSimulatoInValuta, Sum(Val([Sim_Detailed Cust_ Ledg_ Entry.Amount (LCY)])) AS ImportoResiduoSimulatoEuro, [Sim_ Cust_ Ledger Entry].[Letter No_], [Sim_ Cust_ Ledger Entry].[Customer No_], [Sim_Detailed Cust_ Ledg_ Entry].[Posting Date] AS DataRegistrazione, [Sim_ Cust_ Ledger Entry].[Due Date] AS DataScadenza
FROM [Sim_Detailed Cust_ Ledg_ Entry] INNER JOIN [Sim_ Cust_ Ledger Entry] ON [Sim_Detailed Cust_ Ledg_ Entry].[Cust_ Ledger Entry No_] = [Sim_ Cust_ Ledger Entry].[Entry No_]
GROUP BY [Sim_Detailed Cust_ Ledg_ Entry].[Currency Code], [Sim_ Cust_ Ledger Entry].[Letter No_], [Sim_ Cust_ Ledger Entry].[Customer No_], [Sim_Detailed Cust_ Ledg_ Entry].[Posting Date], [Sim_ Cust_ Ledger Entry].[Due Date]
HAVING (((Sum(Val([Sim_Detailed Cust_ Ledg_ Entry.Amount])))<>0) AND ((Sum(Val([Sim_Detailed Cust_ Ledg_ Entry.Amount (LCY)])))<>0));

