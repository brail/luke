SELECT [InventarioAllaData-step0-pre-sfuse-0].[Item No_], [InventarioAllaData-step0-pre-sfuse-0].[Location Code], Sum([InventarioAllaData-step0-pre-sfuse-0].qty) AS qty
FROM [InventarioAllaData-step0-pre-sfuse-0]
GROUP BY [InventarioAllaData-step0-pre-sfuse-0].[Item No_], [InventarioAllaData-step0-pre-sfuse-0].[Location Code]
HAVING (((Sum([InventarioAllaData-step0-pre-sfuse-0].qty))<>0));

