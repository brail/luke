SELECT [Assortment Ledger Entry].[Location Code], [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[Constant Variable Code], [Assortment Ledger Entry].[Assortment Code], "" AS [Bin Code], "" AS Code, Sum(Val([Quantity])) AS qty
FROM [Assortment Ledger Entry]
GROUP BY [Assortment Ledger Entry].[Location Code], [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[Constant Variable Code], [Assortment Ledger Entry].[Assortment Code], ""
HAVING ((([Assortment Ledger Entry].[Location Code])="PMAG" Or ([Assortment Ledger Entry].[Location Code])="SPMAG") AND ((Sum(Val([Quantity])))<>0));

