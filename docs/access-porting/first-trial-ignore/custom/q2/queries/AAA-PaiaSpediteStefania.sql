SELECT [DDT_Picking Header].[Document Type], Sum(Val([DDT_Picking Line.quantity])) AS paiaSpedite, [Sales Header].[selling season code], Item.[Season Code], Item.[Trademark Code], [Sales Header].[Order Type]
FROM ((([DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON ([DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) AND ([DDT_Picking Header].[Document Type] = [DDT_Picking Line].[Document Type])) INNER JOIN Item ON [DDT_Picking Line].No_ = Item.No_) INNER JOIN [Sales Line] ON ([DDT_Picking Line].[Order Line No_] = [Sales Line].[Line No_]) AND ([DDT_Picking Line].[Order No_] = [Sales Line].[Document No_])) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([DDT_Picking Line].Type)=2) AND (([DDT_Picking Header].[Posted Date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]) AND ((Item.[advertising material])=0))
GROUP BY [DDT_Picking Header].[Document Type], [Sales Header].[selling season code], Item.[Season Code], Item.[Trademark Code], [Sales Header].[Order Type]
HAVING ((([DDT_Picking Header].[Document Type])=0));

