SELECT [Sales Line].*
FROM [Sales Line]
WHERE ((([Sales Line].Type)=19 Or ([Sales Line].Type)=20) AND (([Sales Line].[Document Type])=1));

