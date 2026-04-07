SELECT [Item Ledger Entry].[Adjustment Type Code], [Item Ledger Entry].[Location Code], [Item Ledger Entry].[Model Item No_], [Item Ledger Entry].[Variable Code 01], [Item Ledger Entry].[Variable Code 02], Item.[Season Code], Item.[Line Code], Item.[Trademark Code], (Val([Quantity])) AS giacenza, [Item Ledger Entry].[Posting Date], [Item Ledger Entry].[Document No_]
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_
WHERE ((([Item Ledger Entry].[Model Item No_]) Like "*ARIA*") AND (([Item Ledger Entry].[Variable Code 01])="WBN") AND (([Item Ledger Entry].[Posting Date])=#9/25/2019#) AND (([Item Ledger Entry].[Document No_])="RETT INVENTARIALE"));

