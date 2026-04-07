SELECT Item.[Trademark Code], Item.[Season Code], Item.[Model Item No_], Val([quantity]) AS qty, [Item Ledger Entry].*, [Item Ledger Entry].[Location Code]
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_
WHERE ((([Item Ledger Entry].[Location Code])="venezia"));

