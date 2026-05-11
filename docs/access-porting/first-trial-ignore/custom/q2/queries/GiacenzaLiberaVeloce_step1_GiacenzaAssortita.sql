SELECT [Assortment Ledger Entry Item].[Location Code], [Assortment Ledger Entry Item].[Item No_], Sum(Val([quantity])) AS qty, Item.[trademark code], [Assortment Ledger Entry Item].[season code], "GIAC" AS CAT_1, "ASSORTITO" AS CAT_2
FROM [Assortment Ledger Entry Item] INNER JOIN Item ON [Assortment Ledger Entry Item].[Item No_] = Item.No_
GROUP BY [Assortment Ledger Entry Item].[Location Code], [Assortment Ledger Entry Item].[Item No_], Item.[trademark code], [Assortment Ledger Entry Item].[season code], "GIAC", "ASSORTITO"
HAVING (((Sum(Val([quantity])))>0) AND ((Item.[trademark code])=[Forms]![principale]![FiltroMarchioSourcing]) AND (([Assortment Ledger Entry Item].[season code])=[Forms]![principale]![FiltroStagioneSourcing]));

