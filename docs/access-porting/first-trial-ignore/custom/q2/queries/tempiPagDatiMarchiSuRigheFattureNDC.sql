SELECT [Sales Cr_Memo Line].[Document No_], Max([Sales Cr_Memo Line].[Shortcut Dimension 2 Code]) AS DimMarchio
FROM [Sales Cr_Memo Line]
GROUP BY [Sales Cr_Memo Line].[Document No_];

UNION ALL SELECT [Document No_], Max([Shortcut Dimension 2 Code]) AS DimMarchio
FROM [Sales Invoice Line]
GROUP BY [Sales Invoice Line].[Document No_];

