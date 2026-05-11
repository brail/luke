SELECT [Warehouse Entry].[Location Code], [Warehouse Entry].[Bin Code], Item.[model item no_], Item.[variable code 01], Item.[variable code 02], Sum(Val([quantity])) AS qty
FROM [Warehouse Entry] INNER JOIN Item ON [Warehouse Entry].[Item No_] = Item.No_
GROUP BY [Warehouse Entry].[Location Code], [Warehouse Entry].[Bin Code], Item.[model item no_], Item.[variable code 01], Item.[variable code 02]
HAVING (((Sum(Val([quantity])))>0));

