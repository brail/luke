SELECT [Sales Line].Type, [Sales Line].[Document Type], [Sales Line].[Document No_], [Sales Line].[Sell-to Customer No_], Item.[Trademark Code] AS Marchio, Item.[Season Code] AS Stagione, Item.[Line Code] AS Linea, Item.[Model Item No_] AS Articolo, Item_1.Description, Item_1.[Description 2], [Sales Line].[Variable Code 01] AS Colore, [Sales Line].[Variable Code 02] AS taglia, Val([quantity]) AS quantita
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_
WHERE ((([Sales Line].Type)=2) AND (([Sales Line].[Document Type])=1) AND (([Sales Line].[Document No_])=[Numero ODV]))
ORDER BY Item.[Trademark Code], Item.[Season Code], Item.[Model Item No_], [Sales Line].[Variable Code 01], [Sales Line].[Variable Code 02];

