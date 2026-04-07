SELECT [Transfer Line].[Transfer-from Code], [Transfer Line].[Transfer-to Code], [Transfer Line].[Item No_], [Transfer Line].[Constant Variable Code], [Transfer Line].[Variable Code 01], [Transfer Line].[Assortment Code], [Transfer Line].[Variable Code 02], [Transfer Line].[Line Type], [Transfer Line].[Item Type], [Transfer Line].[Receipt Date], [Transfer Line].[Shipment Date], Val([Quantity]) AS qty, Val([no_ of pairs]) AS pairs, Val([Quantity Shipped]) AS qtyshp, [Transfer Line].[Completely Shipped], Val([Quantity Received]) AS qtyrec, [Transfer Line].[Completely Received], [Transfer Line].Status
FROM [Transfer Line]
WHERE ((([Transfer Line].[Document No_])="TRO-21/01407"));

