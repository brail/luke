SELECT [Sales Line].[Document No_], Item.[Season Code]
FROM [Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_
GROUP BY [Sales Line].[Document No_], Item.[Season Code];

