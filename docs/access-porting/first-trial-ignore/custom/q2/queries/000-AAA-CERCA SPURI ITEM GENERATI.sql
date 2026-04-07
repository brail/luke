SELECT Item.[Model Item No_], Count(Item.No_) AS ConteggioDiNo_, Item.[Season Code], Item.[Trademark Code], Item.[Configurator Relation], [Model Item Variable Group].[Variable Group Sequence], [Model Item Variable Group].[Variable Group], [Model Item Variable Group].[Variable Code Limit]
FROM [Model Item Variable Group] INNER JOIN Item ON [Model Item Variable Group].[Model Item No_] = Item.[Model Item No_]
GROUP BY Item.[Model Item No_], Item.[Season Code], Item.[Trademark Code], Item.[Configurator Relation], [Model Item Variable Group].[Variable Group Sequence], [Model Item Variable Group].[Variable Group], [Model Item Variable Group].[Variable Code Limit]
HAVING (((Item.[Trademark Code]) Like "sa%") AND ((Item.[Configurator Relation])=3) AND (([Model Item Variable Group].[Variable Group Sequence])=1))
ORDER BY Count(Item.No_) DESC;

