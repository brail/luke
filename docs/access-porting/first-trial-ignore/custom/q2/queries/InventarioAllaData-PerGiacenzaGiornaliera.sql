INSERT INTO inventarioAndamento ( [Trademark Code], [Season Code], [Location Code], Paia, InventoryDate )
SELECT Item.[Trademark Code], Item.[Season Code], [Item Ledger Entry].[Location Code], Sum(Val([Quantity])) AS Paia, [Inventory_Date] AS InventoryDate
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_
WHERE ((([Item Ledger Entry].[Posting Date])<=[Inventory_Date]) AND ((Item.[advertising material])=0))
GROUP BY Item.[Trademark Code], Item.[Season Code], [Item Ledger Entry].[Location Code], [Inventory_Date], Item.[Configurator Relation]
HAVING (((Sum(Val([Quantity])))<>0) AND ((Item.[Configurator Relation])=3));

