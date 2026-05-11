SELECT [Sales Line].[Document No_], [Sales Line].[Line No_], [Sales Line].No_, [Sales Line].Type, [Sales Line].[Constant Variable Code]
FROM [Sales Line]
WHERE ((([Sales Line].No_)<>"") AND (([Sales Line].Type)=19 Or ([Sales Line].Type)=20) AND (([Sales Line].[Constant Variable Code])=""));

