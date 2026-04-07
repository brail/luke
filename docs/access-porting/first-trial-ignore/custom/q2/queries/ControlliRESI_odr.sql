SELECT EANCodes_CleanDoubled_PerResi.[Cross-Reference No_], Item.[trademark code], Item.[season code], [Sales Line].[MODEL ITEM NO_], Item.[Description 2] AS Description2_ODR, [Sales Line].[VARIABLE CODE 01] AS COLOR_ODR, [Sales Line].[variable code 02] AS SIZE_ODR, Sum(Val([QUANTITY])) AS QTY_RESI, [Sales Line].[Document No_]
FROM ([Sales Line] INNER JOIN EANCodes_CleanDoubled_PerResi ON [Sales Line].No_ = EANCodes_CleanDoubled_PerResi.[Item No_]) INNER JOIN Item ON [Sales Line].[Model Item No_] = Item.No_
GROUP BY EANCodes_CleanDoubled_PerResi.[Cross-Reference No_], Item.[trademark code], Item.[season code], [Sales Line].[MODEL ITEM NO_], Item.[Description 2], [Sales Line].[VARIABLE CODE 01], [Sales Line].[variable code 02], [Sales Line].[Document No_], [Sales Line].Type
HAVING ((([Sales Line].[Document No_])=[forms]![principale]![FiltroORDControlliLettureRESI]) AND (([Sales Line].Type)=2));

