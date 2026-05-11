SELECT [Purchase Line].[Season Code], [Purchase Line].[Buy-from Vendor No_], [Purchase Line].[Shortcut Dimension 2 Code], [Purchase Line].[Document No_], [Purchase Line].No_, Item.[Description 2], [Purchase Line].[Constant Variable Code], Sum(Val([NO_ OF PAIRS])) AS PAIA
FROM [Purchase Line] INNER JOIN Item ON [Purchase Line].No_ = Item.No_
GROUP BY [Purchase Line].[Season Code], [Purchase Line].[Buy-from Vendor No_], [Purchase Line].[Shortcut Dimension 2 Code], [Purchase Line].[Document No_], [Purchase Line].No_, Item.[Description 2], [Purchase Line].[Constant Variable Code], [Purchase Line].Type, [Purchase Line].[DELETE REASON]
HAVING ((([Purchase Line].[Season Code])="I25") AND (([Purchase Line].[Shortcut Dimension 2 Code])="NAPA") AND (([Purchase Line].[Document No_])="ODA-24-00116" Or ([Purchase Line].[Document No_])="ODA-24-00120") AND (([Purchase Line].Type)=20) AND (([Purchase Line].[DELETE REASON])=""));

