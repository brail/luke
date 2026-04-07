SELECT Item.[Model Item No_] AS no_, (Val([Standard Cost])) AS [landed Cost]
FROM Item
WHERE (((Item.[Configurator Relation])=3) AND (((Val([Standard Cost])))>0));

