SELECT EANCodes_CleanDoubled_PerBLAC.[Cross-Reference No_], [DDT_Picking Line].[MODEL ITEM NO_], [DDT_Picking Line].[VARIABLE CODE 01] AS COLOR_spd, [DDT_Picking Line].[variable code 02] AS SIZE_spd, Sum(Val([QUANTITY])) AS QTY_bolla, [DDT_Picking Line].[Document No_]
FROM [DDT_Picking Line] INNER JOIN EANCodes_CleanDoubled_PerBLAC ON [DDT_Picking Line].No_ = EANCodes_CleanDoubled_PerBLAC.[Item No_]
GROUP BY EANCodes_CleanDoubled_PerBLAC.[Cross-Reference No_], [DDT_Picking Line].[MODEL ITEM NO_], [DDT_Picking Line].[VARIABLE CODE 01], [DDT_Picking Line].[variable code 02], [DDT_Picking Line].[Document No_], [DDT_Picking Line].Type
HAVING ((([DDT_Picking Line].[Document No_])=[forms]![principale]![FiltroSpdControlliLettureBLAC]) AND (([DDT_Picking Line].Type)=2));

