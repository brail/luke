SELECT [DDT_Picking Line].Type, [DDT_Picking Line].[Document No_], [DDT_Picking Line].[Sell-to Customer No_], Item.[Trademark Code] AS Marchio, Item.[Season Code] AS Stagione, Item.[Line Code] AS Linea, Item.[Model Item No_] AS Articolo, Item_1.Description, Item_1.[Description 2], [DDT_Picking Line].[Variable Code 01] AS Colore, [DDT_Picking Line].[Variable Code 02] AS taglia, Val([quantity]) AS quantita
FROM (Item INNER JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_) INNER JOIN [DDT_Picking Line] ON Item.No_ = [DDT_Picking Line].No_
WHERE ((([DDT_Picking Line].Type)=2) AND (([DDT_Picking Line].[Document No_])=[Numero SPD]))
ORDER BY Item.[Trademark Code], Item.[Season Code], Item.[Model Item No_], [DDT_Picking Line].[Variable Code 01], [DDT_Picking Line].[Variable Code 02];

