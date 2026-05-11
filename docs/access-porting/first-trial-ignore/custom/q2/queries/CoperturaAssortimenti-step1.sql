SELECT Item.[trademark code], Item.[season code], Item.[product sex], Item.[line code], Item.No_, Item.[Variable Code 01] AS Color, [CoperturaAssortimenti-step1-pre].[Assortment Code], [CoperturaAssortimenti-step1-pre].[Variable Code], Item.[Sales_Purchase Status - Item]
FROM Item INNER JOIN [CoperturaAssortimenti-step1-pre] ON (Item.[Assortment Variable Group] = [CoperturaAssortimenti-step1-pre].[Variable Group]) AND (Item.No_ = [CoperturaAssortimenti-step1-pre].[Model Item No_])
GROUP BY Item.[trademark code], Item.[season code], Item.[product sex], Item.[line code], Item.No_, Item.[Variable Code 01], [CoperturaAssortimenti-step1-pre].[Assortment Code], [CoperturaAssortimenti-step1-pre].[Variable Code], Item.[Sales_Purchase Status - Item]
HAVING (((Item.[line code])<>""))
ORDER BY Item.[trademark code], Item.[season code], Item.[line code], Item.[Variable Code 01], [CoperturaAssortimenti-step1-pre].[Variable Code];

