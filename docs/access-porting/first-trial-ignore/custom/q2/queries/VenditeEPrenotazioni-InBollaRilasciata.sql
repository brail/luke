SELECT [DDT_Picking Line].[Order No_] AS OrdineNumero, [DDT_Picking Line].[Order Line No_] AS OrdineRiga, Sum(Val([quantity])) AS assortmentQty, Sum(Val([No_ of pairs])) AS pairsQty, "BOLLA RILASCIATA" AS statusRiga, [DDT_Picking Header].[Selling Season Code] AS [Season Code], [Sales Header].[Location Code] AS SalesLocation
FROM (([DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type]) AND ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_])) INNER JOIN Item ON [DDT_Picking Line].No_ = Item.No_) INNER JOIN [Sales Header] ON [DDT_Picking Line].[Order No_] = [Sales Header].No_
WHERE ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Header].Status)=1) AND (([DDT_Picking Line].Type)=20))
GROUP BY [DDT_Picking Line].[Order No_], [DDT_Picking Line].[Order Line No_], "BOLLA RILASCIATA", [DDT_Picking Header].[Selling Season Code], [Sales Header].[Location Code]
HAVING (((Sum(Val([quantity])))<>0) AND (([DDT_Picking Header].[Selling Season Code])=[forms]![principale]![filtroStagioneprenotazioni]));

