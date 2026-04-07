SELECT [Item Ledger Entry].[Entry Type], [Item Ledger Entry].[Posting Date], [Item Ledger Entry].[Document No_], [Item Ledger Entry].[Location Code], Val([Quantity]) AS qty, Item.[Trademark Code], Item.[Season Code], Item.[Line Code], [Item Ledger Entry].[model item no_]
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_;

