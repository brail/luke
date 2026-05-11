SELECT [Sales Line].[Document No_], [Sales Line].[Line No_], (Val([Sales Line.Line Amount])-Val([Sales Line.inv_ Discount Amount])) AS ValoreNetto, [Sales Line].[Document Type], [Sales Line].Reference, [Sales Line].[Customer Order Ref_], Val([No_ of pairs]) AS PaiaOrdine
FROM [Sales Line]
WHERE ((([Sales Line].[Document Type])=1));

