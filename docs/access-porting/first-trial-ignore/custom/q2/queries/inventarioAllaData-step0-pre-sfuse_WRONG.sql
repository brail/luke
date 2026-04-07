SELECT [InventarioAllaData-step0-pre-tot].[Item No_], [InventarioAllaData-step0-pre-tot].[Location Code], [InventarioAllaData-step0-pre-tot.qty]-IIf(IsNull([inventarioAllaData-step0-pre-assort.item no_])=False,[inventarioAllaData-step0-pre-assort.qty],0) AS qty
FROM [InventarioAllaData-step0-pre-tot] LEFT JOIN [inventarioAllaData-step0-pre-assort] ON ([InventarioAllaData-step0-pre-tot].[Location Code] = [inventarioAllaData-step0-pre-assort].[Location Code]) AND ([InventarioAllaData-step0-pre-tot].[Item No_] = [inventarioAllaData-step0-pre-assort].[Item No_])
WHERE ((([InventarioAllaData-step0-pre-tot.qty]-IIf(IsNull([inventarioAllaData-step0-pre-assort.item no_])=False,[inventarioAllaData-step0-pre-assort.qty],0))<>0));

