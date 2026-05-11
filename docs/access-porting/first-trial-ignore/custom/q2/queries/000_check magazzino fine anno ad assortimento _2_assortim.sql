SELECT [Assortment Ledger Entry].[Document No_], [Assortment Ledger Entry].[Entry No_], [Assortment Ledger Entry].[Posting Date], [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[CONSTANT VARIABLE CODE], [Assortment Ledger Entry].[Assortment Code], [Assortment Ledger Entry].[Location Code], (Val([QUANTITY])) AS QTY, [Assortment Ledger Entry].[Entry Type]
FROM [Assortment Ledger Entry]
WHERE ((([Assortment Ledger Entry].[Model Item No_])="NP0A4FKTCX") AND (([Assortment Ledger Entry].[CONSTANT VARIABLE CODE])="02U") AND (([Assortment Ledger Entry].[Location Code])="SPMAG") AND (([Assortment Ledger Entry].[Entry Type])=3))
ORDER BY [Assortment Ledger Entry].[Posting Date];

