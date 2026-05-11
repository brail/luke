SELECT [External Linked Documents].[Source Type], [External Linked Documents].[Document Type], [External Linked Documents].[Linked Document], [Sales Line].[Document No_]
FROM [Sales Line] INNER JOIN [External Linked Documents] ON ([Sales Line].No_ = [External Linked Documents].[Source No_]) AND ([Sales Line].[Constant Variable Code] = [External Linked Documents].[Constant Variable Code])
GROUP BY [External Linked Documents].[Source Type], [External Linked Documents].[Document Type], [External Linked Documents].[Linked Document], [Sales Line].[Document No_], [Sales Line].[delete reason]
HAVING ((([External Linked Documents].[Source Type])=4) AND (([External Linked Documents].[Document Type])=2) AND (([Sales Line].[Document No_])=[Forms]![Principale]![FiltroODVEAN]) AND (([Sales Line].[delete reason])=""));

