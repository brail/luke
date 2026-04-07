SELECT [Item Ledger Entry].[Item No_], [Item Ledger Entry].[Location Code], Sum(Val([Quantity])) AS qty
FROM [Item Ledger Entry]
WHERE ((([Item Ledger Entry].[Posting Date])<=[forms]![principale]![datafinale]))
GROUP BY [Item Ledger Entry].[Item No_], [Item Ledger Entry].[Location Code];

