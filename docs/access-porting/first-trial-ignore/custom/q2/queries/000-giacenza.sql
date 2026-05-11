SELECT [Item Ledger Entry].[Location Code], [Item Ledger Entry].[Model Item No_], [Item Ledger Entry].[Variable Code 01], [Item Ledger Entry].[Variable Code 02], Item.[Season Code], Item.[Line Code], Item.[Trademark Code], Sum(Val([Quantity])) AS giacenza
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_
GROUP BY [Item Ledger Entry].[Location Code], [Item Ledger Entry].[Model Item No_], [Item Ledger Entry].[Variable Code 01], [Item Ledger Entry].[Variable Code 02], Item.[Season Code], Item.[Line Code], Item.[Trademark Code]
HAVING ((([Item Ledger Entry].[Location Code])="pmag"));

