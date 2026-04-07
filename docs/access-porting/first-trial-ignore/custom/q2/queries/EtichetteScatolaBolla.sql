SELECT [DDT_Picking Line].[Document No_], Sum(Val([quantity])) AS QTY, [DDT_Picking Line].[Sell-to Customer No_]
FROM [DDT_Picking Line]
WHERE ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Line].Type)=2))
GROUP BY [DDT_Picking Line].[Document No_], [DDT_Picking Line].[Sell-to Customer No_]
HAVING ((([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or (([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD]) Or (([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD] Or ([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD])));

