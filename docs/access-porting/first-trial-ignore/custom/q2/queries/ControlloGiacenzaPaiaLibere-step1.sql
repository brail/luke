SELECT [Item Ledger Entry].[Item No_], Sum(Val([Quantity])) AS quantita, [Item Ledger Entry].[Location Code]
FROM [Item Ledger Entry]
WHERE ((([Item Ledger Entry].[Posting Date])<=[forms]![principale]![FiltroDataPerControlloGiacenze]))
GROUP BY [Item Ledger Entry].[Item No_], [Item Ledger Entry].[Location Code]
HAVING (((Sum(Val([Quantity])))>0));

