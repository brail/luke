SELECT [Purchase Line].[Document No_], [Purchase Line].No_, [Purchase Line].[Constant Variable Code], Sum(Val([no_ of pairs])) AS TotQty
FROM [Purchase Line]
WHERE ((([Purchase Line].[Document Type])=1))
GROUP BY [Purchase Line].[Delete Reason], [Purchase Line].[Document No_], [Purchase Line].No_, [Purchase Line].[Constant Variable Code]
HAVING ((([Purchase Line].[Delete Reason])="") AND ((Sum(Val([no_ of pairs])))>0));

