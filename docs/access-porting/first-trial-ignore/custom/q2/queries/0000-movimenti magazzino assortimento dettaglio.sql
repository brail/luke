SELECT [Assortment Ledger Entry].[Entry No_], [Assortment Ledger Entry].[Entry Type], [Assortment Ledger Entry].[Posting Date], [Assortment Ledger Entry].[Document No_], [Assortment Ledger Entry].Description, [Assortment Ledger Entry].[Location Code], [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[Constant Variable Code], [Assortment Ledger Entry].[Assortment Code], IIf([Assortment Ledger Entry.positive]=0,Val([quantity]),-Val([quantity])) AS qty, [Assortment Ledger Entry].Positive
FROM [Assortment Ledger Entry]
WHERE ((([Assortment Ledger Entry].[Model Item No_])="9SMONROE01/MIX") AND (([Assortment Ledger Entry].[Constant Variable Code])="PIQ") AND (([Assortment Ledger Entry].[Assortment Code])="BW02"))
ORDER BY [Assortment Ledger Entry].[Entry No_];

