SELECT [Purchase Line].[Document Type], [Purchase Line].Type, [Purchase Line].[Document No_], [Purchase Line].No_, [Purchase Line].Quantity, [Purchase Line].[Unit of Measure], [Purchase Line].[Constant Variable Code], [Purchase Line].[Assortment Code], [Purchase Line].[No_ of Pairs], [Purchase Line].[Delete Reason], [Purchase Line].[Currency Code], [Purchase Line].[Unit Cost], [Purchase Line].[Line Amount]
FROM [Purchase Line]
WHERE ((([Purchase Line].Type)=20) AND (([Purchase Line].[Delete Reason])=""));

