SELECT [Cust_ Ledger Entry_1].[Document Type], [Cust_ Ledger Entry_1].[Entry No_] AS ChiaveMovimentoFatturaNotaCredito, [Cust_ Ledger Entry].[Entry No_] AS ChiaveMovimentoPagamento, -Val([Cust_ Ledger Entry.Closed by Amount]) AS ImportoAbbinato, -Val([Cust_ Ledger Entry_1.Closed by Amount]) AS ImportoAbbinato1, "1 Fatt/NC a N Pag" AS collegamento
FROM [Cust_ Ledger Entry] INNER JOIN [Cust_ Ledger Entry] AS [Cust_ Ledger Entry_1] ON [Cust_ Ledger Entry].[Closed by Entry No_]=[Cust_ Ledger Entry_1].[Entry No_]
WHERE ((([Cust_ Ledger Entry_1].[Document Type])=2));

