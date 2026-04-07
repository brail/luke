SELECT [Cust_ Ledger Entry_1].[Entry No_] AS ChiaveMovimentoFatturaNotaCredito, [Cust_ Ledger Entry].[Entry No_] AS ChiaveMovimentoPagamento, Round(-Val([Cust_ Ledger Entry.Closed by Amount])*10000)/10000 AS ImportoAbbinato, "1 Fatt/NC a N Pag" AS collegamento, [Cust_ Ledger Entry_1].[Document Type], [Cust_ Ledger Entry_1].[dimension set id], IIf([Cust_ Ledger Entry.document type]=2 Or [Cust_ Ledger Entry.document type]=3,"Y","N") AS testComp
FROM [Cust_ Ledger Entry] INNER JOIN [Cust_ Ledger Entry] AS [Cust_ Ledger Entry_1] ON [Cust_ Ledger Entry].[Closed by Entry No_] = [Cust_ Ledger Entry_1].[Entry No_]
WHERE ((([Cust_ Ledger Entry_1].[Document Type])=2 Or ([Cust_ Ledger Entry_1].[Document Type])=3));

