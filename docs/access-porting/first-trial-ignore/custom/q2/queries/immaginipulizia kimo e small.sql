SELECT [External Linked Documents].[Source No_], [External Linked Documents].[Constant Variable Code], [External Linked Documents].[Linked Document], [External Linked Documents].[Document Type]
FROM [External Linked Documents]
WHERE ((([External Linked Documents].[Source Type])=4) AND (([External Linked Documents].[Document Type])=5 Or ([External Linked Documents].[Document Type])=6));

