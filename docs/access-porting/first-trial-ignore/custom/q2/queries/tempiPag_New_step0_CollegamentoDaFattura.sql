SELECT [Cust_ Ledger Entry].[Entry No_] AS ChiaveMovimentoFatturaNotaCredito, IIf(IsNull([Cust_ Ledger Entry_1.entry no_])=False,[Cust_ Ledger Entry_1.entry no_],0) AS ChiaveMovimentoPagamento, Round(Val([Cust_ Ledger Entry.Closed by Amount])*10000)/10000 AS ImportoAbbinato, "N Fatt/NC a 1 Pag" AS collegamento, [Cust_ Ledger Entry].[Document Type], IIf([Cust_ Ledger Entry_1.document type]=2 Or [Cust_ Ledger Entry_1.document type]=3,"Y","N") AS testComp
FROM [Cust_ Ledger Entry] INNER JOIN [Cust_ Ledger Entry] AS [Cust_ Ledger Entry_1] ON [Cust_ Ledger Entry].[Closed by Entry No_] = [Cust_ Ledger Entry_1].[Entry No_]
WHERE ((([Cust_ Ledger Entry].[Document Type])=2 Or ([Cust_ Ledger Entry].[Document Type])=3));

