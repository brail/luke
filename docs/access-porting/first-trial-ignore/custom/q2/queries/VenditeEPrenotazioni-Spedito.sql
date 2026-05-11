SELECT [Sales Line].[Document Type], [Sales Line].[Document No_] AS OrdineNumero, [Sales Line].[Line No_] AS OrdineRiga, [Sales Line].Type, Val([quantity shipped]) AS assortmentQty, IIf(Val([quantity])<>0,Val([No_ of pairs])*Val([quantity shipped])/Val([quantity]),0) AS pairsQty, "SPED" AS statusRiga, [Sales Header].[Selling Season Code] AS [Season Code], [Sales Header].[Location Code] AS SalesLocation
FROM ([Sales Line] LEFT JOIN Item ON [Sales Line].No_ = Item.No_) RIGHT JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=20) AND ((Val([quantity shipped]))<>0) AND (([Sales Header].[Selling Season Code])=[forms]![principale]![filtroStagioneprenotazioni]));

