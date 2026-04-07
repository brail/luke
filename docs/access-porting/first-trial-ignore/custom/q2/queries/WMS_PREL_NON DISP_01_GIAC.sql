SELECT [Assortment Ledger Entry].[Location Code], [Assortment Ledger Entry].[Model Item No_], Val([Quantity]) AS qty, [Assortment Ledger Entry].[Constant Variable Code], [Assortment Ledger Entry].[Assortment Code]
FROM [Assortment Ledger Entry]
WHERE ((([Assortment Ledger Entry].[Model Item No_])="F5MURRAY01/LES") AND (([Assortment Ledger Entry].[Constant Variable Code])="NVY/GRY") AND (([Assortment Ledger Entry].[Assortment Code])="BM01" Or ([Assortment Ledger Entry].[Assortment Code])="BM08")) OR ((([Assortment Ledger Entry].[Model Item No_])="F5OLYMPIA11/GLI") AND (([Assortment Ledger Entry].[Constant Variable Code])="DKB") AND (([Assortment Ledger Entry].[Assortment Code])="BW07" Or ([Assortment Ledger Entry].[Assortment Code])="BW08"));

