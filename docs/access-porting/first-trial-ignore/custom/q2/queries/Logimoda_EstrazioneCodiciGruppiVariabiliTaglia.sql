SELECT [Variable Group].[Variable Group], [Variable Group].Description, [Variable Group].[Variable Type], [Variable Code].[Variable Code], [Variable Code].[Order Variable Code]
FROM [Variable Group] INNER JOIN [Variable Code] ON [Variable Group].[Variable Group] = [Variable Code].[Variable Group]
WHERE ((([Variable Group].[Variable Type])="MISURA"));

