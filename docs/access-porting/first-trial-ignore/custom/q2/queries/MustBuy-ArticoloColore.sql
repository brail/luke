SELECT Item.[Must Buy], Item.[Variable Code 01], Item.[Model Item No_], Item.[Configurator Relation]
FROM Item
GROUP BY Item.[Must Buy], Item.[Variable Code 01], Item.[Model Item No_], Item.[Configurator Relation]
HAVING (((Item.[Configurator Relation])=3));

