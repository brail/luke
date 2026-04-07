UPDATE [Assortment Ledger Entry Item] INNER JOIN [Assortment Ledger Entry] ON [Assortment Ledger Entry Item].[Assortment Ledger Entry No_] = [Assortment Ledger Entry].[Entry No_] SET [Assortment Ledger Entry].[Posting Date] = #1/6/2020#, [Assortment Ledger Entry Item].[Posting Date] = #1/6/2020#
WHERE ((([Assortment Ledger Entry].[Document No_])="ROA-19-00479"));

