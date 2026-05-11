SELECT [Item Ledger Entry].[Model Item No_] AS No_, [Item Ledger Entry].[Variable Code 01], Sum(Val([quantity])) AS PairsInventory
FROM ([Item Ledger Entry] INNER JOIN Location ON [Item Ledger Entry].[Location Code] = Location.Code) INNER JOIN Item ON [Item Ledger Entry].[Model Item No_] = Item.No_
WHERE (((Location.[Enable to Purchase Run])=True) AND ((Item.[season code])=[FiltroSTAGIONEVendutoComprato]) AND ((Item.[Trademark Code])=[FiltroMarchioVendutoComprato]))
GROUP BY [Item Ledger Entry].[Model Item No_], [Item Ledger Entry].[Variable Code 01]
HAVING (((Sum(Val([quantity])))<>0));

