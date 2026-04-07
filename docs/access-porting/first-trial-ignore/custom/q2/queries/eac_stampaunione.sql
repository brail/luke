SELECT [DDT_Picking Line].[Document No_], [DDT_Picking Line].[Model Item No_], [DDT_Picking Line].[Variable Code 01], [DDT_Picking Line].[Variable Code 02], Val([Quantity]) AS qty
FROM [DDT_Picking Line]
WHERE ((([DDT_Picking Line].Type)=2) AND (([DDT_Picking Line].[Document No_])=[Forms]![principale]![NumeroSPD]));

