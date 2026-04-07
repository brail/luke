SELECT [Purchase Line].[Document Type], [Purchase Line].Type, [Purchase Line].[Document No_], [Purchase Line].No_, [Purchase Line].[Unit of Measure], [Purchase Line].[Constant Variable Code], [Purchase Line].[Assortment Code], [Purchase Line].[Delete Reason], Val([Quantity]) AS QuantityPurchased, Val([No_ of Pairs]) AS PairsPurchased, Item.[TRADEMARK CODE], [Purchase Line].[SEASON CODE]
FROM [Purchase Line] INNER JOIN Item ON [Purchase Line].No_ = Item.No_
WHERE ((([Purchase Line].[Document Type])=1) AND (([Purchase Line].Type)=19) AND (([Purchase Line].[Delete Reason])="") AND ((Item.[TRADEMARK CODE])=[FiltroMarchioVendutoComprato]) AND (([Purchase Line].[SEASON CODE])=[FiltroStagioneVendutoComprato]));

