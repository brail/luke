SELECT [Cust_ Ledger Entry].[Document Type], [Cust_ Ledger Entry].[Entry No_] AS ChiaveMovimentoFatturaNotaCredito, IIf(IsNull([Cust_ Ledger Entry_1.entry no_])=False,[Cust_ Ledger Entry_1.entry no_],0) AS ChiaveMovimentoPagamento, Val([Cust_ Ledger Entry.Closed by Amount]) AS ImportoAbbinato, IIf(IsNull([Cust_ Ledger Entry_1.entry no_])=False,Val([Cust_ Ledger Entry_1.Closed by Amount]),0) AS ImportoAbbinato1, "N Fatt/NC a 1 Pag" AS collegamento
FROM [Cust_ Ledger Entry] LEFT JOIN [Cust_ Ledger Entry] AS [Cust_ Ledger Entry_1] ON [Cust_ Ledger Entry].[Closed by Entry No_] = [Cust_ Ledger Entry_1].[Entry No_]
WHERE ((([Cust_ Ledger Entry].[Document Type])=2));

