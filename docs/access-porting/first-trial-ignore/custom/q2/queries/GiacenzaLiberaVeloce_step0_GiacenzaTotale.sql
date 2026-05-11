SELECT [Item Ledger Entry].[Item No_], [Item Ledger Entry].[Location Code], Sum(Val([quantity])) AS qty, Item.[Trademark code], Item.[Season code], "GIAC_TOT" AS CAT_1, "" AS CAT_2
FROM [Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_
GROUP BY [Item Ledger Entry].[Item No_], [Item Ledger Entry].[Location Code], Item.[Trademark code], Item.[Season code], "GIAC_TOT", ""
HAVING (((Sum(Val([quantity])))>0) AND ((Item.[Trademark code])=[Forms]![principale]![FiltroMarchioSourcing]) AND ((Item.[Season code])=[Forms]![principale]![FiltroStagioneSourcing]));

