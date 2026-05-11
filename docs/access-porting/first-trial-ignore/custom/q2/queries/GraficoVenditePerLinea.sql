SELECT Item.[Line Code] AS Linea, Item.[Trademark Code] AS Marchio, Item.[Season Code] AS Stagione, Sum(IIf([delete reason]='' Or IsNull([delete reason])=True,Val([no_ of pairs]),0)) AS PaiaConfermate
FROM [Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_
GROUP BY Item.[Line Code], Item.[Trademark Code], Item.[Season Code], [Sales Line].[Document Type], [Sales Line].Type
HAVING (((Item.[Trademark Code])=[parametroMarchio]) AND ((Item.[Season Code])=[parametroStagione]) AND (([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=19 Or ([Sales Line].Type)=20))
ORDER BY Sum(IIf([delete reason]='' Or IsNull([delete reason])=True,Val([no_ of pairs]),0)) DESC;

