SELECT [immaginipulizia kimo e small].[Source No_], [immaginipulizia kimo e small].[Constant Variable Code], [immaginipulizia kimo e small].[Document Type], [immaginipulizia kimo e small].[Linked Document], Item.[Season Code]
FROM [immaginipulizia kimo e small] INNER JOIN Item ON [immaginipulizia kimo e small].[Source No_] = Item.No_
WHERE ((([immaginipulizia kimo e small].[Linked Document])="") AND ((Item.[Season Code])="e17"))
ORDER BY [immaginipulizia kimo e small].[Source No_], [immaginipulizia kimo e small].[Constant Variable Code];

