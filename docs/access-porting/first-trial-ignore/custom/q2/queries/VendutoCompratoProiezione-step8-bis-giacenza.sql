SELECT [Assortment Ledger Entry].[Model Item No_] AS No_, [Assortment Ledger Entry].[Constant Variable Code], Sum(Val([quantity])*[assortmentquantity]) AS PairsInventory
FROM (([Assortment Ledger Entry] INNER JOIN Location ON [Assortment Ledger Entry].[Location Code] = Location.Code) INNER JOIN AssortimentiQuantita ON ([Assortment Ledger Entry].[Assortment Code] = AssortimentiQuantita.[Assortment Code]) AND ([Assortment Ledger Entry].[Assortment Variable Group] = AssortimentiQuantita.[Variable Group])) INNER JOIN Item ON [Assortment Ledger Entry].[Model Item No_] = Item.No_
WHERE (((Location.[Enable to Purchase Run])=True) AND (([Assortment Ledger Entry].[season code])=[FiltroSTAGIONEVendutoComprato]) AND ((Item.[Trademark Code])=[FiltroMarchioVendutoComprato]))
GROUP BY [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[Constant Variable Code]
HAVING (((Sum(Val([quantity])*[assortmentquantity]))<>0));

