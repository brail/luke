SELECT [Assortment Ledger Entry].*, [Assortment Ledger Entry Item].*, [Assortment Ledger Entry].[Document No_]
FROM [Assortment Ledger Entry Item] INNER JOIN [Assortment Ledger Entry] ON [Assortment Ledger Entry Item].[Assortment Ledger Entry No_] = [Assortment Ledger Entry].[Entry No_]
WHERE ((([Assortment Ledger Entry].[Document No_])="TRS-24/00002" Or ([Assortment Ledger Entry].[Document No_])="TRS-23/01409"));

