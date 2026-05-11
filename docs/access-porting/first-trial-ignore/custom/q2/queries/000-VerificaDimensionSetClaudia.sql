SELECT [Sales Line].[Document No_], [Sales Line].No_, [Sales Header].[selling season code], [Sales Line].[dimension set id], [Dimension Set Entry].[Dimension Code], [Dimension Set Entry].[Dimension Value Code]
FROM ([Sales Header] INNER JOIN [Sales Line] ON [Sales Header].No_ = [Sales Line].[Document No_]) LEFT JOIN [Dimension Set Entry] ON [Sales Line].[Dimension Set ID] = [Dimension Set Entry].[Dimension Set ID]
WHERE ((([Sales Line].Type)=20) AND (([Sales Header].[selling season code])="I22"));

