SELECT Sum(Val([quantity shipped])) AS qty, [Sales Line].[Document No_]
FROM [Sales Line]
WHERE ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=2))
GROUP BY [Sales Line].[Document No_]
HAVING (((Sum(Val([quantity shipped])))>0));

