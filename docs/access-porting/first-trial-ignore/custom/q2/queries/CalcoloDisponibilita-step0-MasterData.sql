SELECT "MasterData" AS Cat, Item.[trademark code] AS Trademark, Item.[season code] AS [selling season code], Item.[line code], Item.[Model Item No_] AS Article, Item.[Description 2], Item.[Variable code 01] AS Color, [Valid Model Item Assortments].[assortment code] AS Assortment, 0 AS qty, 0 AS Pairs
FROM Item INNER JOIN [Valid Model Item Assortments] ON Item.[Model Item No_] = [Valid Model Item Assortments].[Model Item No_]
WHERE (((Item.[configurator relation])=3) AND ((Item.[advertising material])=0))
GROUP BY Item.[trademark code], Item.[season code], Item.[line code], Item.[Model Item No_], Item.[Description 2], Item.[Variable code 01], [Valid Model Item Assortments].[assortment code]
HAVING (((Item.[trademark code])=[forms]![principale]![FiltroMarchioSourcing]) AND ((Item.[season code])=[forms]![principale]![FiltroStagioneSourcing]));

