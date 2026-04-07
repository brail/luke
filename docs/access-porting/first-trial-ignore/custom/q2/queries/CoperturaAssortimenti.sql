SELECT [CoperturaAssortimenti-step2].[Trademark Code], [CoperturaAssortimenti-step2].[Season Code], [CoperturaAssortimenti-step2].[Product Sex], [CoperturaAssortimenti-step2].[Line Code], [CoperturaAssortimenti-step2].No_, [CoperturaAssortimenti-step2].Color, [CoperturaAssortimenti-step2].LineTyoe, [CoperturaAssortimenti-step2].[Assortment Code], [CoperturaAssortimenti-step2].[Variable Code 02], [CoperturaAssortimenti-step2].[Sales_Purchase Status - Item]
FROM [CoperturaAssortimenti-step2]
WHERE ((([CoperturaAssortimenti-step2].[Season Code])=[forms]![principale]![FiltroStagioneEAN]))
ORDER BY [CoperturaAssortimenti-step2].[Trademark Code], [CoperturaAssortimenti-step2].[Season Code], [CoperturaAssortimenti-step2].[Product Sex], [CoperturaAssortimenti-step2].[Line Code], [CoperturaAssortimenti-step2].LineTyoe, [CoperturaAssortimenti-step2].[Assortment Code], [CoperturaAssortimenti-step2].[Variable Code 02];

