SELECT [Warehouse Journal Line].[Journal Batch Name], [Warehouse Journal Line].[Line No_], [Warehouse Journal Line].[Item No_], [Warehouse Journal Line].[Constant Variable Code], [Warehouse Journal Line].[Assortment Code], [Warehouse Journal Line].Quantity, [Warehouse Journal Line].[From Zone Code], [Warehouse Journal Line].[From Bin Code], [Warehouse Journal Line].[To Zone Code], [Warehouse Journal Line].[To bin Code]
FROM [Warehouse Journal Line]
WHERE ((([Warehouse Journal Line].[Journal Batch Name])=[Giornale]) AND (([Warehouse Journal Line].[Line No_])>=[RigaBase]-20000 And ([Warehouse Journal Line].[Line No_])<=[RigaBase]+20000))
ORDER BY [Warehouse Journal Line].[Line No_];

