UPDATE [Assortment Ledger Entry Item] INNER JOIN [Assortment Ledger Entry] ON [Assortment Ledger Entry Item].[Assortment Ledger Entry No_] = [Assortment Ledger Entry].[Entry No_] SET [Assortment Ledger Entry].[Posting Date] = #11/14/2024#, [Assortment Ledger Entry Item].[Posting Date] = #11/14/2024#
WHERE ((([Assortment Ledger Entry].[Document No_])="CAR-RES-VE-24/01530"));

